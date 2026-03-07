import { id, CreateTransferError } from "tigerbeetle-node";
import { formatTransferError } from "./tb-errors.js";
import { AccountId, TransferCode } from "./config.js";
import { createTransfer } from "./transfers.js";
import { getBankById } from "./banks.js";
import { getProductById } from "./products.js";
import { getAllCustomers } from "./customers.js";
import { ASSET_SCALE } from "./config.js";
import { chunkArray, createTransfersForGroupsAdaptive, lookupAccountsBatched } from "./tb-batches.js";

const DAYS_PER_YEAR = 365;
const LOOKUP_ACCOUNTS_BATCH_SIZE = 4096;
const CREATE_TRANSFERS_BATCH_SIZE = 256;
const ACCRUAL_LOG_PREFIX = "[accrual]";
const MIN_REALISABLE_AMOUNT = 10n ** BigInt(ASSET_SCALE - 2);

function zeroAccrualResult(productId, extra = {}) {
  return {
    product_id: productId,
    gross_accrued: "0.00000000",
    customer_accrued: "0.00000000",
    fee_accrued: "0.00000000",
    realised: "0.00000000",
    transfers: [],
    ...extra,
  };
}

/**
 * Calculate one day's interest for a balance at the given gross annual rate.
 * Returns amount in scale8 (BigInt).
 */
function dailyInterestScale8(balanceScale8, grossRate) {
  if (grossRate <= 0) return 0n;
  const interestScale8 = Number(balanceScale8) * (grossRate / DAYS_PER_YEAR);
  return BigInt(Math.floor(interestScale8));
}

/**
 * Accrue one day of interest for a product.
 * Interest compounds daily on (principal + accrued interest payable).
 * Debits bank interest receivable, credits customer accrued interest plus platform fee income,
 * then realises any whole pennies of customer interest into principal in the same batch.
 */
export async function accrueInterest(client, productId) {
  const product = getProductById(productId);
  if (!product) throw new Error(`Product ${productId} not found`);
  const bank = getBankById(product.bank_id);
  if (!bank) throw new Error(`Bank ${product.bank_id} not found`);
  const grossRate = product.gross_rate;
  if (grossRate <= 0) throw new Error(`Product ${productId} has no gross rate set`);

  const customersWithProduct = getAllCustomers().filter((c) => c.product_positions[productId]);
  console.log(
    `${ACCRUAL_LOG_PREFIX} start product=${productId} bank=${bank.bank_id} customers=${customersWithProduct.length} gross_rate=${grossRate} fee_share=${product.fee_share}`
  );
  if (customersWithProduct.length === 0) {
    return zeroAccrualResult(productId);
  }

  const accountIds = [];
  for (const customer of customersWithProduct) {
    const position = customer.product_positions[productId];
    const principalId = typeof position.principal_account_id === "bigint"
      ? position.principal_account_id
      : BigInt(position.principal_account_id);
    const accruedInterestId = typeof position.accrued_interest_account_id === "bigint"
      ? position.accrued_interest_account_id
      : BigInt(position.accrued_interest_account_id);
    accountIds.push(principalId, accruedInterestId);
  }
  const lookupChunks = chunkArray(accountIds, LOOKUP_ACCOUNTS_BATCH_SIZE);
  console.log(
    `${ACCRUAL_LOG_PREFIX} lookupAccounts product=${productId} account_ids=${accountIds.length} chunks=${lookupChunks.length} chunk_sizes=${lookupChunks.map((chunk) => chunk.length).join(",")}`
  );
  let accounts;
  try {
    accounts = await lookupAccountsBatched(client, accountIds, LOOKUP_ACCOUNTS_BATCH_SIZE);
  } catch (error) {
    console.error(
      `${ACCRUAL_LOG_PREFIX} lookupAccounts failed product=${productId} account_ids=${accountIds.length} chunks=${lookupChunks.length}: ${error.message}`
    );
    throw error;
  }
  const balanceByAccountId = new Map();
  for (const a of accounts) {
    const id = typeof a.id === "bigint" ? a.id : BigInt(a.id);
    const balance = BigInt(a.credits_posted) - BigInt(a.debits_posted);
    balanceByAccountId.set(id, balance);
  }

  const transferGroups = [];
  let totalGross = 0n;
  let totalCustomer = 0n;
  let totalFee = 0n;
  let totalRealised = 0n;
  for (const customer of customersWithProduct) {
    const position = customer.product_positions[productId];
    const principalAccountId = typeof position.principal_account_id === "bigint"
      ? position.principal_account_id
      : BigInt(position.principal_account_id);
    const interestAccountId = typeof position.accrued_interest_account_id === "bigint"
      ? position.accrued_interest_account_id
      : BigInt(position.accrued_interest_account_id);
    const principalBalance = balanceByAccountId.get(principalAccountId) ?? 0n;
    const accruedInterestBalance = balanceByAccountId.get(interestAccountId) ?? 0n;
    const compoundingBalance = principalBalance + accruedInterestBalance;
    const grossInterestScale8 = dailyInterestScale8(compoundingBalance, grossRate);
    if (grossInterestScale8 <= 0n) continue;

    const feeScale8 = BigInt(Math.floor(Number(grossInterestScale8) * product.fee_share));
    const customerInterestScale8 = grossInterestScale8 - feeScale8;
    const customerTransfers = [];
    if (customerInterestScale8 > 0n) {
      customerTransfers.push(
        createTransfer({
          id: id(),
          debit_account_id: bank.interest_receivable_account_id,
          credit_account_id: interestAccountId,
          amount: customerInterestScale8,
          code: TransferCode.INTEREST_ACCRUAL_CUSTOMER,
        })
      );
    }
    const realisedScale8 = ((accruedInterestBalance + customerInterestScale8) / MIN_REALISABLE_AMOUNT) * MIN_REALISABLE_AMOUNT;
    if (realisedScale8 > 0n) {
      customerTransfers.push(
        createTransfer({
          id: id(),
          debit_account_id: interestAccountId,
          credit_account_id: principalAccountId,
          amount: realisedScale8,
          code: TransferCode.INTEREST_CAPITALISATION,
        })
      );
      totalRealised += realisedScale8;
    }
    if (feeScale8 > 0n) {
      customerTransfers.push(
        createTransfer({
          id: id(),
          debit_account_id: bank.interest_receivable_account_id,
          credit_account_id: AccountId.FEE_INCOME,
          amount: feeScale8,
          code: TransferCode.INTEREST_ACCRUAL_FEE,
        })
      );
    }

    if (customerTransfers.length > 0) {
      transferGroups.push({
        customer_id: customer.customer_id,
        transfers: customerTransfers,
      });
    }
    totalGross += grossInterestScale8;
    totalCustomer += customerInterestScale8;
    totalFee += feeScale8;
  }

  if (transferGroups.length === 0) {
    const totalBalance = [...balanceByAccountId.values()].reduce((s, b) => s + b, 0n);
    return zeroAccrualResult(productId, {
      customers_with_product: customersWithProduct.length,
      accounts_found: balanceByAccountId.size,
      total_balance_scale8: totalBalance.toString(),
    });
  }

  console.log(
    `${ACCRUAL_LOG_PREFIX} createTransfers product=${productId} customer_groups=${transferGroups.length} transfers=${transferGroups.reduce((sum, group) => sum + group.transfers.length, 0)} max_batch=${CREATE_TRANSFERS_BATCH_SIZE}`
  );

  try {
    const submissions = await createTransfersForGroupsAdaptive(client, transferGroups, {
      maxItems: CREATE_TRANSFERS_BATCH_SIZE,
      onBatch: ({ groups, transfers }) => {
        console.log(
          `${ACCRUAL_LOG_PREFIX} createTransfers batch product=${productId} transfers=${transfers.length} customers=${groups.length}`
        );
      },
    });

    for (const submission of submissions) {
      for (const err of submission.errors) {
        if (err.result !== CreateTransferError.exists) {
          throw new Error(formatTransferError(err.result));
        }
      }
    }
  } catch (error) {
    console.error(
      `${ACCRUAL_LOG_PREFIX} createTransfers failed product=${productId}: ${error.message}`
    );
    throw error;
  }

  console.log(
    `${ACCRUAL_LOG_PREFIX} complete product=${productId} gross=${(Number(totalGross) / 10 ** ASSET_SCALE).toFixed(8)} customer=${(Number(totalCustomer) / 10 ** ASSET_SCALE).toFixed(8)} fee=${(Number(totalFee) / 10 ** ASSET_SCALE).toFixed(8)} realised=${(Number(totalRealised) / 10 ** ASSET_SCALE).toFixed(8)}`
  );

  return {
    product_id: productId,
    gross_accrued: (Number(totalGross) / 10 ** ASSET_SCALE).toFixed(8),
    customer_accrued: (Number(totalCustomer) / 10 ** ASSET_SCALE).toFixed(8),
    fee_accrued: (Number(totalFee) / 10 ** ASSET_SCALE).toFixed(8),
    realised: (Number(totalRealised) / 10 ** ASSET_SCALE).toFixed(8),
    transfers: transferGroups.map(({ customer_id }) => customer_id),
  };
}

/**
 * Record bank interest received (realisation). Debits client money, credits bank interest receivable.
 */
export async function recordBankInterestReceived(client, amountScale8, receivableAccountId, transferId = id()) {
  if (amountScale8 <= 0n) throw new Error("Amount must be positive");
  if (!receivableAccountId) throw new Error("receivableAccountId required");
  const transfer = createTransfer({
    id: transferId,
    debit_account_id: AccountId.CLIENT_MONEY,
    credit_account_id: BigInt(receivableAccountId),
    amount: amountScale8,
    code: TransferCode.INTEREST_REALISATION,
  });
  const errors = await client.createTransfers([transfer]);
  if (errors.length > 0) {
    if (errors[0].result !== CreateTransferError.exists) {
      throw new Error(formatTransferError(errors[0].result));
    }
  }
  return { amount: (Number(amountScale8) / 10 ** ASSET_SCALE).toFixed(8) };
}

export async function collectFees(client, amountScale8) {
  if (amountScale8 <= 0n) throw new Error("Amount must be positive");
  const transfer = createTransfer({
    id: id(),
    debit_account_id: AccountId.OPERATING_CASH,
    credit_account_id: AccountId.CLIENT_MONEY,
    amount: amountScale8,
    code: TransferCode.FEE_COLLECTION,
  });
  const errors = await client.createTransfers([transfer]);
  if (errors.length > 0) {
    if (errors[0].result !== CreateTransferError.exists) {
      throw new Error(formatTransferError(errors[0].result));
    }
  }
  return { amount: (Number(amountScale8) / 10 ** ASSET_SCALE).toFixed(8) };
}
