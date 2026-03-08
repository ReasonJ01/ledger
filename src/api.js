import { createClient, CreateTransferError, id } from "tigerbeetle-node";
import { ensureAccounts } from "./accounts.js";
import { addStatementLine } from "./simulator/interface.js";
import { createCustomer, getAllCustomers, getCustomerById, openProductAccount } from "./customers.js";
import { createProduct, getAllProducts, getProductById } from "./products.js";
import { createBank, getAllBanks, getBankById } from "./banks.js";
import { allocateToProduct, requestWithdrawal, withdrawToHolding } from "./deposit.js";
import { accrueInterest, collectFees } from "./interest.js";
import { processPendingStatementLines } from "./statement-processor.js";
import { formatTransferError } from "./tb-errors.js";
import { amountToScale8, createTransfer } from "./transfers.js";
import { AccountId, ASSET_SCALE, PHYSICAL_ACCOUNT_IBAN, TransferCode } from "./config.js";
import { chunkArray, createTransfersForGroupsAdaptive, lookupAccountsBatched } from "./tb-batches.js";

const TB_ADDRESS = process.env.TB_ADDRESS || "3000";
const TB_CLUSTER_ID = BigInt(process.env.TB_CLUSTER_ID || "1");
const BALANCES_LOOKUP_BATCH_SIZE = 256;
const LOAD_DIRECT_TRANSFER_BATCH_SIZE = 256;
const LOAD_STATEMENT_FLUSH_THRESHOLD = 2048;
let client;

function assetBalance(account) {
  return BigInt(account.debits_posted) - BigInt(account.credits_posted);
}

function creditBalance(account) {
  return BigInt(account.credits_posted) - BigInt(account.debits_posted);
}

function formatScale8(amountScale8) {
  return (Number(amountScale8) / 10 ** ASSET_SCALE).toFixed(8);
}

function accountOrZero(accountsById, accountId) {
  return accountsById.get(accountId.toString());
}

function getAssetBalance(accountsById, accountId) {
  const account = accountOrZero(accountsById, accountId);
  return account ? assetBalance(account) : 0n;
}

function getCreditBalance(accountsById, accountId) {
  const account = accountOrZero(accountsById, accountId);
  return account ? creditBalance(account) : 0n;
}

async function lookupLedgerAccounts() {
  const lookupIds = [
    AccountId.SAFEGUARD_POOLED_CASH,
    AccountId.UNIDENTIFIED_RECEIPTS,
    AccountId.OPERATING_CASH,
    AccountId.FEE_INCOME,
  ];

  for (const bank of getAllBanks()) {
    lookupIds.push(bank.placement_in_transit_account_id, bank.principal_placed_account_id, bank.interest_due_account_id);
  }

  for (const customer of getAllCustomers()) {
    lookupIds.push(customer.available_cash_account_id, customer.withdrawal_in_progress_account_id);
    for (const position of Object.values(customer.product_positions)) {
      lookupIds.push(
        position.subscription_in_progress_account_id,
        position.principal_invested_account_id,
        position.interest_accrued_account_id,
        position.redemption_in_progress_account_id
      );
    }
  }

  const accounts = await lookupAccountsBatched(client, lookupIds, BALANCES_LOOKUP_BATCH_SIZE);
  return new Map(accounts.map((account) => [account.id.toString(), account]));
}

function randomAmount(minAmount, maxAmount) {
  const min = Number(minAmount);
  const max = Number(maxAmount);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0 || max < min) {
    throw new Error("Invalid min/max amount");
  }
  return (Math.random() * (max - min) + min).toFixed(2);
}

function randomPick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffleInPlace(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function mergeStatementProcessingStats(target, processed) {
  target.statement_lines_processed += processed.total ?? 0;
  target.statement_transfer_batches += processed.transfer_batches ?? 0;
  target.statement_transfer_batch_attempts += processed.transfer_batch_attempts ?? 0;
  target.statement_oversized_batch_splits += processed.oversized_batch_splits ?? 0;
  target.statement_transfers_posted += processed.transfers_posted ?? 0;
  target.statement_failed += processed.failed ?? 0;
  target.statement_skipped += processed.skipped ?? 0;
}

function findGroupIndexByTransferIndex(groupRanges, transferIndex) {
  for (let index = 0; index < groupRanges.length; index += 1) {
    const range = groupRanges[index];
    if (transferIndex >= range.start && transferIndex <= range.end) {
      return index;
    }
  }
  return -1;
}

function buildLoadPlan({
  pool,
  product_id,
  rounds,
  payments_per_round,
  deposits_per_round,
  withdrawals_to_holding_per_round,
  withdrawals_to_nominated_per_round,
  min_amount,
  max_amount,
}) {
  const planStartedAt = Date.now();
  const plannedRounds = [];
  let instructionsPlanned = 0;

  for (let round = 0; round < Number(rounds); round += 1) {
    const instructions = [];

    for (let i = 0; i < Number(payments_per_round); i += 1) {
      const customer = randomPick(pool);
      instructions.push({
        kind: "inject",
        customer_id: customer.customer_id,
        virtual_iban: customer.virtual_iban,
        amount: randomAmount(min_amount, max_amount),
      });
    }

    for (let i = 0; i < Number(deposits_per_round); i += 1) {
      const customer = randomPick(pool);
      const position = customer.product_positions[product_id];
      instructions.push({
        kind: "deposit",
        customer_id: customer.customer_id,
        amount: randomAmount(min_amount, max_amount),
        holding_account_id: customer.available_cash_account_id,
        subscription_account_id: position.subscription_in_progress_account_id,
        principal_account_id: position.principal_invested_account_id,
      });
    }

    for (let i = 0; i < Number(withdrawals_to_holding_per_round); i += 1) {
      const customer = randomPick(pool);
      const position = customer.product_positions[product_id];
      instructions.push({
        kind: "withdraw_holding",
        customer_id: customer.customer_id,
        amount: randomAmount(min_amount, max_amount),
        holding_account_id: customer.available_cash_account_id,
        subscription_account_id: position.subscription_in_progress_account_id,
        principal_account_id: position.principal_invested_account_id,
      });
    }

    for (let i = 0; i < Number(withdrawals_to_nominated_per_round); i += 1) {
      const customer = randomPick(pool);
      instructions.push({
        kind: "withdraw_nominated",
        customer_id: customer.customer_id,
        amount: randomAmount(min_amount, max_amount),
      });
    }

    shuffleInPlace(instructions);
    instructionsPlanned += instructions.length;
    plannedRounds.push({ instructions });
  }

  return {
    rounds: plannedRounds,
    instructions_planned: instructionsPlanned,
    planning_ms: Date.now() - planStartedAt,
  };
}

function buildLoadTransferGroup(action, bankPlacementInTransitAccountId) {
  const amountScale8 = amountToScale8(action.amount);

  if (action.kind === "deposit") {
    return {
      kind: action.kind,
      transfers: [
        createTransfer({
          id: id(),
          debit_account_id: BigInt(action.holding_account_id),
          credit_account_id: BigInt(action.subscription_account_id),
          amount: amountScale8,
          code: TransferCode.PRODUCT_SUBSCRIPTION_REQUESTED,
        }),
        createTransfer({
          id: id(),
          debit_account_id: BigInt(action.subscription_account_id),
          credit_account_id: BigInt(action.principal_account_id),
          amount: amountScale8,
          code: TransferCode.PRODUCT_SUBSCRIPTION_CONFIRMED,
        }),
        createTransfer({
          id: id(),
          debit_account_id: BigInt(bankPlacementInTransitAccountId),
          credit_account_id: AccountId.SAFEGUARD_POOLED_CASH,
          amount: amountScale8,
          code: TransferCode.BANK_PLACEMENT_CONFIRMED,
        }),
      ],
    };
  }

  if (action.kind === "withdraw_holding") {
    return {
      kind: action.kind,
      transfers: [
        createTransfer({
          id: id(),
          debit_account_id: BigInt(action.principal_account_id),
          credit_account_id: BigInt(action.holding_account_id),
          amount: amountScale8,
          code: TransferCode.PRODUCT_REDEMPTION_COMPLETED,
        }),
      ],
    };
  }

  throw new Error(`Unsupported direct load action: ${action.kind}`);
}

async function addLoadStatementLine(action) {
  if (action.kind === "inject") {
    await addStatementLine({
      amount: action.amount,
      creditor_account_iban: action.virtual_iban,
    });
    return;
  }

  if (action.kind === "withdraw_nominated") {
    await addStatementLine({
      amount: action.amount,
      credit_debit_indicator: "DBIT",
      debtor_account_iban: PHYSICAL_ACCOUNT_IBAN,
      creditor_account_iban: `GBNOM${action.customer_id}`.slice(0, 22),
      event_type: "CUSTOMER_WITHDRAWAL_NOMINATED",
      source_customer_id: action.customer_id,
    });
    return;
  }

  throw new Error(`Unsupported statement load action: ${action.kind}`);
}

async function executeLoadTransferGroups(groups, stats) {
  if (groups.length === 0) {
    return;
  }

  let submissions;
  try {
    submissions = await createTransfersForGroupsAdaptive(client, groups, {
      maxItems: LOAD_DIRECT_TRANSFER_BATCH_SIZE,
      onBatch: () => {
        stats.direct_transfer_batch_attempts += 1;
      },
      onOversizedSplit: () => {
        stats.direct_oversized_batch_splits += 1;
      },
    });
  } catch (error) {
    stats.direct_batch_failures += 1;
    for (const group of groups) {
      if (group.kind === "deposit") stats.deposits_failed += 1;
      else if (group.kind === "withdraw_holding") stats.withdraw_holding_failed += 1;
    }
    return;
  }

  for (const submission of submissions) {
    stats.direct_transfer_batches += 1;
    const batch = submission.groups;
    const errors = submission.errors;
    const groupRanges = [];
    let offset = 0;
    for (const group of batch) {
      groupRanges.push({ start: offset, end: offset + group.transfers.length - 1 });
      offset += group.transfers.length;
    }

    const groupErrors = new Map();
    for (const err of errors) {
      if (err.result === CreateTransferError.exists) {
        continue;
      }
      const groupIndex = findGroupIndexByTransferIndex(groupRanges, err.index ?? 0);
      if (groupIndex === -1) {
        continue;
      }
      if (!groupErrors.has(groupIndex)) {
        groupErrors.set(groupIndex, new Set());
      }
      groupErrors.get(groupIndex).add(formatTransferError(err.result));
    }

    for (const [groupIndex, group] of batch.entries()) {
      if (groupErrors.has(groupIndex)) {
        if (group.kind === "deposit") stats.deposits_failed += 1;
        else if (group.kind === "withdraw_holding") stats.withdraw_holding_failed += 1;
        continue;
      }

      stats.direct_transfers_posted += group.transfers.length;
      if (group.kind === "deposit") stats.deposits_ok += 1;
      else if (group.kind === "withdraw_holding") stats.withdraw_holding_ok += 1;
    }
  }
}

async function getPendingPlacementAmount(tbClient, bankId) {
  const bank = getBankById(bankId);
  if (!bank) return null;

  const [pendingAccount] = await tbClient.lookupAccounts([bank.placement_in_transit_account_id]);
  return pendingAccount ? assetBalance(pendingAccount) : 0n;
}

async function getBankInterestReceivableAmount(tbClient, bankId) {
  const bank = getBankById(bankId);
  if (!bank) return null;

  const [receivable] = await tbClient.lookupAccounts([bank.interest_due_account_id]);
  return receivable ? assetBalance(receivable) : 0n;
}

async function getCollectableFeeAmount(tbClient) {
  const accounts = await tbClient.lookupAccounts([
    AccountId.FEE_INCOME,
    AccountId.OPERATING_CASH,
    AccountId.SAFEGUARD_POOLED_CASH,
  ]);

  let feeIncome = 0n;
  let operatingCash = 0n;
  let clientMoney = 0n;

  for (const account of accounts) {
    if (account.id === AccountId.FEE_INCOME) feeIncome = creditBalance(account);
    if (account.id === AccountId.OPERATING_CASH) operatingCash = assetBalance(account);
    if (account.id === AccountId.SAFEGUARD_POOLED_CASH) clientMoney = assetBalance(account);
  }

  const uncollectedFees = feeIncome - operatingCash;
  if (uncollectedFees <= 0n || clientMoney <= 0n) return 0n;
  return uncollectedFees < clientMoney ? uncollectedFees : clientMoney;
}

export async function init() {
  client = createClient({
    cluster_id: TB_CLUSTER_ID,
    replica_addresses: [TB_ADDRESS],
  });
  await ensureAccounts(client);
  return client;
}

export function getClient() {
  return client;
}

export async function apiProcessStatementLines() {
  return processPendingStatementLines(client, { log: false });
}

export async function apiCreateCustomer() {
  const customer = await createCustomer(client);
  return { customer_id: customer.customer_id, virtual_iban: customer.virtual_iban };
}

export async function apiCreateProduct(productId, bankId, name, grossRate, feeShare = 0) {
  if (!productId || !bankId) throw new Error("product_id and bank_id required");
  const product = createProduct(productId, bankId, name, grossRate, feeShare);
  return {
    product_id: product.product_id,
    bank_id: product.bank_id,
    gross_rate: product.gross_rate,
    fee_share: product.fee_share,
  };
}

export async function apiCreateBank(bankId = "BANK_A") {
  const bank = await createBank(client, bankId);
  return { bank_id: bank.bank_id };
}

export async function apiOpenProduct(customerId, productId) {
  await openProductAccount(client, customerId, productId);
  return { customer_id: customerId, product_id: productId };
}

export async function apiInject(amount = "10.00", customerOrIban) {
  let creditorIban = customerOrIban;
  if (customerOrIban) {
    const customer = getCustomerById(customerOrIban);
    if (customer) creditorIban = customer.virtual_iban;
  }
  const line = await addStatementLine({ amount, creditor_account_iban: creditorIban });
  return { amount: line.amount, currency: line.currency, creditor_account_iban: line.creditor_account_iban };
}

export async function apiDeposit(customerId, productId, amount = "10.00") {
  const customer = getCustomerById(customerId);
  if (!customer) throw new Error(`Customer ${customerId} not found`);

  const position = customer.product_positions[productId];
  if (!position) throw new Error(`${customerId} does not have ${productId}`);

  const product = getProductById(productId);
  if (!product) throw new Error(`Product ${productId} not found`);

  const bank = getBankById(product.bank_id);
  if (!bank) throw new Error(`Bank ${product.bank_id} not found`);

  const amountScale8 = amountToScale8(amount);
  await allocateToProduct(
    client,
    amountScale8,
    customer.available_cash_account_id,
    position.subscription_in_progress_account_id,
    position.principal_invested_account_id,
    bank.placement_in_transit_account_id
  );

  return { customer_id: customerId, product_id: productId, amount, bank_id: bank.bank_id };
}

export async function apiWithdrawToHolding(customerId, productId, amount = "10.00") {
  const customer = getCustomerById(customerId);
  if (!customer) throw new Error(`Customer ${customerId} not found`);
  const position = customer.product_positions[productId];
  if (!position) throw new Error(`${customerId} does not have ${productId}`);

  await withdrawToHolding(
    client,
    amountToScale8(amount),
    position.principal_invested_account_id,
    position.redemption_in_progress_account_id,
    customer.available_cash_account_id
  );

  return { customer_id: customerId, product_id: productId, amount };
}

export async function apiWithdrawToNominated(customerId, amount = "10.00") {
  const customer = getCustomerById(customerId);
  if (!customer) throw new Error(`Customer ${customerId} not found`);
  await requestWithdrawal(client, amountToScale8(amount), customer.available_cash_account_id, customer.withdrawal_in_progress_account_id);
  const line = await addStatementLine({
    amount,
    credit_debit_indicator: "DBIT",
    debtor_account_iban: PHYSICAL_ACCOUNT_IBAN,
    creditor_account_iban: `GBNOM${customer.customer_id}`.slice(0, 22),
    event_type: "CUSTOMER_WITHDRAWAL_NOMINATED",
    source_customer_id: customer.customer_id,
  });
  return {
    customer_id: customer.customer_id,
    amount: line.amount,
    simulated: true,
    statement_id: line.transaction_id,
  };
}

export async function apiSettle(bankId) {
  const bank = getBankById(bankId);
  if (!bank) throw new Error(`Bank ${bankId} not found`);

  const pendingPlacement = await getPendingPlacementAmount(client, bankId);
  if (pendingPlacement === 0n) {
    return { bank_id: bankId, amount: "0", settled: false, message: "No pending placements" };
  }

  const line = await addStatementLine({
    amount: formatScale8(pendingPlacement),
    credit_debit_indicator: "DBIT",
    debtor_account_iban: PHYSICAL_ACCOUNT_IBAN,
    creditor_account_iban: `GBBANK${bankId}`.slice(0, 22),
    event_type: "BANK_SETTLEMENT",
    source_bank_id: bankId,
  });
  return {
    bank_id: bankId,
    amount: line.amount,
    settled: true,
    simulated: true,
    statement_id: line.transaction_id,
  };
}

export async function apiSettleable(bankId) {
  const bank = getBankById(bankId);
  if (!bank) return null;
  const unsettled = await getPendingPlacementAmount(client, bankId);
  return formatScale8(unsettled);
}

export async function apiSettleableAll() {
  const result = {};
  for (const bank of getAllBanks()) {
    result[bank.bank_id] = await apiSettleable(bank.bank_id);
  }
  return result;
}

export async function apiBankInterestReceivable(bankId) {
  const bank = getBankById(bankId);
  if (!bank) return null;
  const receivable = await getBankInterestReceivableAmount(client, bankId);
  return formatScale8(receivable ?? 0n);
}

export async function apiBankInterestReceivableAll() {
  const result = {};
  for (const bank of getAllBanks()) {
    result[bank.bank_id] = await apiBankInterestReceivable(bank.bank_id);
  }
  return result;
}

export async function apiSimulateBankInterestPayment(bankId, amount) {
  const bank = getBankById(bankId);
  if (!bank) throw new Error(`Bank ${bankId} not found`);

  const outstanding = await getBankInterestReceivableAmount(client, bankId);
  if (outstanding === null) throw new Error(`No receivable account for ${bankId}`);

  const payment = amount ? amountToScale8(amount) : outstanding;
  if (payment <= 0n) {
    return { bank_id: bankId, amount: "0.00000000", simulated: false, message: "No receivable interest to pay" };
  }
  if (payment > outstanding) {
    throw new Error(`Requested amount exceeds ${bankId} receivable (${formatScale8(outstanding)})`);
  }

  const line = await addStatementLine({
    amount: formatScale8(payment),
    debtor_account_iban: `GBBANK${bankId}`.slice(0, 22),
    creditor_account_iban: PHYSICAL_ACCOUNT_IBAN,
    event_type: "BANK_INTEREST",
    source_bank_id: bankId,
  });
  return {
    bank_id: bankId,
    amount: line.amount,
    simulated: true,
    statement_id: line.transaction_id,
  };
}

export async function apiAccrueInterest(productId) {
  return accrueInterest(client, productId);
}

export async function apiAccrueInterestBank(bankId) {
  const bank = getBankById(bankId);
  if (!bank) throw new Error(`Bank ${bankId} not found`);

  const products = getAllProducts().filter((product) => product.bank_id === bankId);
  console.log(`[accrual] bank-start bank=${bankId} products=${products.length}`);
  if (products.length === 0) {
    return {
      bank_id: bankId,
      gross_accrued: "0.00000000",
      customer_accrued: "0.00000000",
      fee_accrued: "0.00000000",
      products: [],
      message: "No products at this bank",
    };
  }

  let gross = 0n;
  let customer = 0n;
  let fee = 0n;
  let realised = 0n;
  const byProduct = [];

  for (const product of products) {
    console.log(`[accrual] bank-product-start bank=${bankId} product=${product.product_id}`);
    const result = await accrueInterest(client, product.product_id);
    console.log(
      `[accrual] bank-product-complete bank=${bankId} product=${product.product_id} gross=${result.gross_accrued} customer=${result.customer_accrued} fee=${result.fee_accrued} realised=${result.realised}`
    );
    byProduct.push({
      product_id: product.product_id,
      gross_accrued: String(result.gross_accrued),
      customer_accrued: String(result.customer_accrued),
      fee_accrued: String(result.fee_accrued),
      realised: String(result.realised),
    });
    gross += amountToScale8(result.gross_accrued);
    customer += amountToScale8(result.customer_accrued);
    fee += amountToScale8(result.fee_accrued);
    realised += amountToScale8(result.realised);
  }

  return {
    bank_id: bankId,
    gross_accrued: formatScale8(gross),
    customer_accrued: formatScale8(customer),
    fee_accrued: formatScale8(fee),
    realised: formatScale8(realised),
    products: byProduct,
  };
}

export async function apiLoadBootstrap({
  bank_id = "BANK_LOAD",
  product_id = "PRODUCT_LOAD",
  customer_count = 100,
  gross_rate = 0.04,
  fee_share = 0.1,
} = {}) {
  if (!getBankById(bank_id)) {
    await apiCreateBank(bank_id);
  }
  if (!getProductById(product_id)) {
    await apiCreateProduct(product_id, bank_id, product_id, gross_rate, fee_share);
  }

  const customersWithProduct = getAllCustomers().filter((c) => c.product_positions[product_id]).length;
  const needed = Math.max(0, Number(customer_count) - customersWithProduct);
  let created = 0;
  for (let i = 0; i < needed; i++) {
    const customer = await apiCreateCustomer();
    await apiOpenProduct(customer.customer_id, product_id);
    created += 1;
  }

  return {
    bank_id,
    product_id,
    existing_with_product: customersWithProduct,
    created,
    total_with_product: customersWithProduct + created,
  };
}

export async function apiLoadRun({
  product_id,
  rounds = 10,
  payments_per_round = 100,
  deposits_per_round = 80,
  withdrawals_to_holding_per_round = 40,
  withdrawals_to_nominated_per_round = 40,
  min_amount = 1,
  max_amount = 25,
  settle_each_round = true,
} = {}) {
  if (!product_id) throw new Error("product_id required");
  const product = getProductById(product_id);
  if (!product) throw new Error(`Product ${product_id} not found`);
  const bank = getBankById(product.bank_id);
  if (!bank) throw new Error(`Bank ${product.bank_id} not found`);

  const pool = getAllCustomers().filter((c) => c.product_positions[product_id]);
  if (pool.length === 0) throw new Error(`No customers have ${product_id} open`);

  const plan = buildLoadPlan({
    pool,
    product_id,
    rounds,
    payments_per_round,
    deposits_per_round,
    withdrawals_to_holding_per_round,
    withdrawals_to_nominated_per_round,
    min_amount,
    max_amount,
  });
  const startedAt = Date.now();
  const stats = {
    rounds: Number(rounds),
    instructions_planned: plan.instructions_planned,
    planning_ms: plan.planning_ms,
    injected: 0,
    deposits_ok: 0,
    deposits_failed: 0,
    withdraw_holding_ok: 0,
    withdraw_holding_failed: 0,
    nominated_ok: 0,
    nominated_failed: 0,
    statement_lines_processed: 0,
    statement_transfer_batches: 0,
    statement_transfer_batch_attempts: 0,
    statement_oversized_batch_splits: 0,
    statement_transfers_posted: 0,
    statement_failed: 0,
    statement_skipped: 0,
    direct_transfers_posted: 0,
    direct_transfer_batches: 0,
    direct_transfer_batch_attempts: 0,
    direct_oversized_batch_splits: 0,
    direct_batch_failures: 0,
    total_transfers_posted: 0,
    settlements_simulated: 0,
    settlements_none: 0,
    phase_timings_ms: {
      enqueue_statements: 0,
      process_statements: 0,
      direct_transfers: 0,
      settlement: 0,
    },
  };
  stats.heap_used_mb_before = (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2);

  for (const roundPlan of plan.rounds) {
    let pendingStatementActions = 0;
    let pendingDirectGroups = [];
    let pendingDirectTransfers = 0;

    const flushStatements = async () => {
      if (pendingStatementActions === 0) return;
      const started = Date.now();
      const processed = await apiProcessStatementLines();
      stats.phase_timings_ms.process_statements += Date.now() - started;
      mergeStatementProcessingStats(stats, processed);
      pendingStatementActions = 0;
    };

    const flushDirectGroups = async () => {
      if (pendingDirectGroups.length === 0) return;
      const started = Date.now();
      await executeLoadTransferGroups(pendingDirectGroups, stats);
      stats.phase_timings_ms.direct_transfers += Date.now() - started;
      pendingDirectGroups = [];
      pendingDirectTransfers = 0;
    };

    for (const action of roundPlan.instructions) {
      if (action.kind === "inject" || action.kind === "withdraw_nominated") {
        try {
          const started = Date.now();
          await addLoadStatementLine(action);
          stats.phase_timings_ms.enqueue_statements += Date.now() - started;
          if (action.kind === "inject") stats.injected += 1;
          else stats.nominated_ok += 1;
          pendingStatementActions += 1;
        } catch (error) {
          if (action.kind === "inject") {
            throw error;
          }
          stats.nominated_failed += 1;
        }
        if (pendingStatementActions >= LOAD_STATEMENT_FLUSH_THRESHOLD) {
          await flushStatements();
        }
        continue;
      }

      const group = buildLoadTransferGroup(action, bank.placement_in_transit_account_id);
      pendingDirectGroups.push(group);
      pendingDirectTransfers += group.transfers.length;

      if (pendingDirectTransfers >= LOAD_DIRECT_TRANSFER_BATCH_SIZE) {
        if (pendingStatementActions > 0) {
          await flushStatements();
        }
        await flushDirectGroups();
      }
    }

    await flushStatements();
    await flushDirectGroups();

    if (settle_each_round) {
      const started = Date.now();
      const settlement = await apiSettle(bank.bank_id);
      stats.phase_timings_ms.settlement += Date.now() - started;
      if (settlement.settled) {
        stats.settlements_simulated += 1;
        pendingStatementActions += 1;
      } else {
        stats.settlements_none += 1;
      }
    }

    await flushStatements();
  }

  const elapsedMs = Date.now() - startedAt;
  const elapsedSeconds = elapsedMs / 1000;
  stats.total_transfers_posted = stats.direct_transfers_posted + stats.statement_transfers_posted;
  stats.elapsed_ms = elapsedMs;
  stats.elapsed_seconds = elapsedSeconds.toFixed(3);
  stats.transfers_per_second = elapsedSeconds > 0
    ? (stats.total_transfers_posted / elapsedSeconds).toFixed(2)
    : "0.00";
  stats.heap_used_mb_after = (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2);

  return stats;
}

export async function apiCollectableFees() {
  return { amount: formatScale8(await getCollectableFeeAmount(client)) };
}

export async function apiCollectFees(amount) {
  const collectable = await getCollectableFeeAmount(client);
  if (collectable <= 0n) {
    return { amount: "0.00000000", collected: false, message: "No collectable fees" };
  }

  const requested = amount ? amountToScale8(amount) : collectable;
  if (requested > collectable) {
    throw new Error(`Requested amount exceeds collectable fees (${formatScale8(collectable)})`);
  }

  await collectFees(client, requested);
  return { amount: formatScale8(requested), collected: true };
}

export async function apiReconciliation() {
  const accountsById = await lookupLedgerAccounts();

  const clientMoney = getAssetBalance(accountsById, AccountId.SAFEGUARD_POOLED_CASH);
  const operatingCash = getAssetBalance(accountsById, AccountId.OPERATING_CASH);
  const unattributedReceipts = getCreditBalance(accountsById, AccountId.UNIDENTIFIED_RECEIPTS);
  const feeIncome = getCreditBalance(accountsById, AccountId.FEE_INCOME);

  let bankPending = 0n;
  let bankSettled = 0n;
  let bankInterestReceivable = 0n;
  for (const bank of getAllBanks()) {
    bankPending += getAssetBalance(accountsById, bank.placement_in_transit_account_id);
    bankSettled += getAssetBalance(accountsById, bank.principal_placed_account_id);
    bankInterestReceivable += getAssetBalance(accountsById, bank.interest_due_account_id);
  }

  let customerAvailableCash = 0n;
  let withdrawalInProgress = 0n;
  let subscriptionInProgress = 0n;
  let productPrincipal = 0n;
  let accruedInterestPayable = 0n;
  let redemptionInProgress = 0n;
  for (const customer of getAllCustomers()) {
    customerAvailableCash += getCreditBalance(accountsById, customer.available_cash_account_id);
    withdrawalInProgress += getCreditBalance(accountsById, customer.withdrawal_in_progress_account_id);
    for (const position of Object.values(customer.product_positions)) {
      subscriptionInProgress += getCreditBalance(accountsById, position.subscription_in_progress_account_id);
      productPrincipal += getCreditBalance(accountsById, position.principal_invested_account_id);
      accruedInterestPayable += getCreditBalance(accountsById, position.interest_accrued_account_id);
      redemptionInProgress += getCreditBalance(accountsById, position.redemption_in_progress_account_id);
    }
  }

  const totalAssets = clientMoney + operatingCash + bankPending + bankSettled + bankInterestReceivable;
  const customerLiabilities = unattributedReceipts + customerAvailableCash + withdrawalInProgress + subscriptionInProgress + productPrincipal + accruedInterestPayable + redemptionInProgress;
  const liabilitiesAndIncome = customerLiabilities + feeIncome;
  const customerBackingAssets = totalAssets - feeIncome;

  const checks = [
    {
      label: "Ledger balances overall",
      left_label: "Assets",
      left: formatScale8(totalAssets),
      right_label: "Liabilities + income",
      right: formatScale8(liabilitiesAndIncome),
      difference: formatScale8(totalAssets - liabilitiesAndIncome),
      ok: totalAssets === liabilitiesAndIncome,
    },
    {
      label: "Customer funds backed net of fee income",
      left_label: "Assets - fee income",
      left: formatScale8(customerBackingAssets),
      right_label: "Customer liabilities",
      right: formatScale8(customerLiabilities),
      difference: formatScale8(customerBackingAssets - customerLiabilities),
      ok: customerBackingAssets === customerLiabilities,
    },
  ];

  return {
    checks,
    notes: [],
    components: {
      client_money: formatScale8(clientMoney),
      operating_cash: formatScale8(operatingCash),
      bank_pending: formatScale8(bankPending),
      bank_settled: formatScale8(bankSettled),
      bank_interest_receivable: formatScale8(bankInterestReceivable),
      unattributed_receipts: formatScale8(unattributedReceipts),
      customer_available_cash: formatScale8(customerAvailableCash),
      withdrawal_in_progress: formatScale8(withdrawalInProgress),
      subscription_in_progress: formatScale8(subscriptionInProgress),
      product_principal: formatScale8(productPrincipal),
      accrued_interest_payable: formatScale8(accruedInterestPayable),
      redemption_in_progress: formatScale8(redemptionInProgress),
      fee_income: formatScale8(feeIncome),
    },
  };
}

export async function apiBalances() {
  const systemIds = [
    AccountId.SAFEGUARD_POOLED_CASH,
    AccountId.UNIDENTIFIED_RECEIPTS,
    AccountId.OPERATING_CASH,
    AccountId.FEE_INCOME,
  ];
  const systemNames = {
    [AccountId.SAFEGUARD_POOLED_CASH.toString()]: "Safeguard pooled cash",
    [AccountId.UNIDENTIFIED_RECEIPTS.toString()]: "Unidentified receipts",
    [AccountId.OPERATING_CASH.toString()]: "Operating cash",
    [AccountId.FEE_INCOME.toString()]: "Fee income",
  };
  const assetIds = new Set([
    AccountId.SAFEGUARD_POOLED_CASH.toString(),
    AccountId.OPERATING_CASH.toString(),
  ]);
  const customerLabels = new Map();
  const lookupIds = [...systemIds];

  for (const bank of getAllBanks()) {
    lookupIds.push(bank.placement_in_transit_account_id, bank.principal_placed_account_id, bank.interest_due_account_id);
    systemNames[bank.placement_in_transit_account_id.toString()] = `${bank.bank_id} cash pending placement`;
    systemNames[bank.principal_placed_account_id.toString()] = `${bank.bank_id} cash at bank`;
    systemNames[bank.interest_due_account_id.toString()] = `${bank.bank_id} interest receivable`;
    assetIds.add(bank.placement_in_transit_account_id.toString());
    assetIds.add(bank.principal_placed_account_id.toString());
    assetIds.add(bank.interest_due_account_id.toString());
  }

  for (const customer of getAllCustomers()) {
    lookupIds.push(customer.available_cash_account_id, customer.withdrawal_in_progress_account_id);
    customerLabels.set(customer.available_cash_account_id.toString(), `${customer.customer_id} available cash`);
    customerLabels.set(customer.withdrawal_in_progress_account_id.toString(), `${customer.customer_id} withdrawal in progress`);
    for (const [productId, position] of Object.entries(customer.product_positions)) {
      lookupIds.push(
        position.subscription_in_progress_account_id,
        position.principal_invested_account_id,
        position.interest_accrued_account_id,
        position.redemption_in_progress_account_id
      );
      customerLabels.set(position.subscription_in_progress_account_id.toString(), `${customer.customer_id} ${productId} subscription in progress`);
      customerLabels.set(position.principal_invested_account_id.toString(), `${customer.customer_id} ${productId} principal invested`);
      customerLabels.set(position.interest_accrued_account_id.toString(), `${customer.customer_id} ${productId} interest accrued`);
      customerLabels.set(position.redemption_in_progress_account_id.toString(), `${customer.customer_id} ${productId} redemption in progress`);
    }
  }

  const balanceChunks = chunkArray(lookupIds, BALANCES_LOOKUP_BATCH_SIZE);
  console.log(
    `[balances] lookupAccounts total_ids=${lookupIds.length} chunks=${balanceChunks.length} chunk_sizes=${balanceChunks.map((chunk) => chunk.length).join(",")}`
  );
  let accounts;
  try {
    accounts = await lookupAccountsBatched(client, lookupIds, BALANCES_LOOKUP_BATCH_SIZE);
  } catch (error) {
    console.error(
      `[balances] lookupAccounts failed total_ids=${lookupIds.length} chunks=${balanceChunks.length}: ${error.message}`
    );
    throw error;
  }
  const balances = [];
  for (const account of accounts) {
    const idStr = account.id.toString();
    const label = systemNames[idStr] ?? customerLabels.get(idStr) ?? `${idStr.slice(0, 16)}...`;
    const balance = assetIds.has(idStr) ? assetBalance(account) : creditBalance(account);
    balances.push({ label, balance: formatScale8(balance) });
  }

  console.log(`[balances] complete accounts_returned=${accounts.length} balances=${balances.length}`);
  return { balances };
}

export function apiListCustomers() {
  return {
    customers: getAllCustomers().map((customer) => ({
      customer_id: customer.customer_id,
      virtual_iban: customer.virtual_iban,
      products: Object.keys(customer.product_positions),
    })),
  };
}

export function apiListProducts() {
  return {
    products: getAllProducts().map((product) => ({
      product_id: product.product_id,
      bank_id: product.bank_id,
      gross_rate: product.gross_rate,
      fee_share: product.fee_share,
    })),
  };
}

export function apiListBanks() {
  return { banks: getAllBanks().map((bank) => bank.bank_id) };
}





