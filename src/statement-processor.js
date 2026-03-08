import { CreateTransferError } from "tigerbeetle-node";
import { getNewStatementLines } from "./simulator/interface.js";
import { getBankById } from "./banks.js";
import { getCustomerById, getCustomerByVirtualIban } from "./customers.js";
import { formatTransferError } from "./tb-errors.js";
import { AccountId, TransferCode } from "./config.js";
import { amountToScale8, createTransfer } from "./transfers.js";
import { createTransfersForGroupsAdaptive } from "./tb-batches.js";

const STATEMENT_TRANSFER_BATCH_SIZE = 256;
const STATEMENT_LOG_PREFIX = "[statements]";

function statementReference(line) {
  return BigInt(`0x${line.id}`);
}

function statementTransferId(line, key) {
  const transferId = line.transfer_ids?.[key];
  if (!transferId) {
    throw new Error(`Missing transfer id ${key} for ${line.transaction_id}`);
  }
  return BigInt(`0x${transferId}`);
}

function createTransferGroup(line) {
  const amount = amountToScale8(line.amount);
  const user_data_128 = statementReference(line);

  if (line.event_type === "BANK_INTEREST") {
    if (line.credit_debit_indicator !== "CRDT") {
      return { skipped: true, reason: `Skipped ${line.transaction_id}: BANK_INTEREST must be CRDT` };
    }
    const bank = getBankById(line.source_bank_id);
    if (!bank) {
      return { skipped: true, reason: `Skipped ${line.transaction_id}: bank ${line.source_bank_id} not found` };
    }
    return {
      line,
      counter: "bank_interest",
      transfers: [
        createTransfer({
          id: statementTransferId(line, "bank_interest"),
          debit_account_id: AccountId.SAFEGUARD_POOLED_CASH,
          credit_account_id: BigInt(bank.interest_due_account_id),
          amount,
          code: TransferCode.INTEREST_REALISATION,
          user_data_128,
        }),
      ],
      successMessage: `Processed: ${line.amount} ${line.currency} bank interest -> ${bank.bank_id}`,
    };
  }

  if (line.event_type === "BANK_SETTLEMENT") {
    if (line.credit_debit_indicator !== "DBIT") {
      return { skipped: true, reason: `Skipped ${line.transaction_id}: BANK_SETTLEMENT must be DBIT` };
    }
    const bank = getBankById(line.source_bank_id);
    if (!bank) {
      return { skipped: true, reason: `Skipped ${line.transaction_id}: bank ${line.source_bank_id} not found` };
    }
    return {
      line,
      counter: "bank_settlements",
      transfers: [
        createTransfer({
          id: statementTransferId(line, "bank_settlement"),
          debit_account_id: BigInt(bank.principal_placed_account_id),
          credit_account_id: BigInt(bank.placement_in_transit_account_id),
          amount,
          code: TransferCode.BANK_PLACEMENT_CONFIRMED,
          user_data_128,
        }),
      ],
      successMessage: `Processed: ${line.amount} ${line.currency} settlement -> ${bank.bank_id}`,
    };
  }

  if (line.event_type === "CUSTOMER_WITHDRAWAL_NOMINATED") {
    if (line.credit_debit_indicator !== "DBIT") {
      return { skipped: true, reason: `Skipped ${line.transaction_id}: CUSTOMER_WITHDRAWAL_NOMINATED must be DBIT` };
    }
    const customer = getCustomerById(line.source_customer_id);
    if (!customer) {
      return { skipped: true, reason: `Skipped ${line.transaction_id}: customer ${line.source_customer_id} not found` };
    }
    return {
      line,
      counter: "nominated_withdrawals",
      transfers: [
        createTransfer({
          id: statementTransferId(line, "withdrawal_to_nominated"),
          debit_account_id: BigInt(customer.withdrawal_in_progress_account_id),
          credit_account_id: AccountId.SAFEGUARD_POOLED_CASH,
          amount,
          code: TransferCode.WITHDRAWAL_PAID,
          user_data_128,
        }),
      ],
      successMessage: `Processed: ${line.amount} ${line.currency} nominated withdrawal -> ${customer.customer_id}`,
    };
  }

  if (line.credit_debit_indicator !== "CRDT") {
    return { skipped: true, reason: `Skipped ${line.transaction_id}: unsupported debit statement line` };
  }

  const customer = getCustomerByVirtualIban(line.creditor_account_iban);
  const transfers = [
    createTransfer({
      id: statementTransferId(line, "money_received"),
      debit_account_id: AccountId.SAFEGUARD_POOLED_CASH,
      credit_account_id: AccountId.UNIDENTIFIED_RECEIPTS,
      amount,
      code: TransferCode.MONEY_RECEIVED,
      user_data_128,
    }),
  ];

  let successMessage = `Processed: ${line.amount} ${line.currency} -> Unattributed (no customer for ${line.creditor_account_iban})`;
  if (customer) {
    transfers.push(
      createTransfer({
        id: statementTransferId(line, "customer_identified"),
        debit_account_id: AccountId.UNIDENTIFIED_RECEIPTS,
        credit_account_id: BigInt(customer.available_cash_account_id),
        amount,
        code: TransferCode.CUSTOMER_IDENTIFIED,
        user_data_128,
      })
    );
    successMessage = `Processed: ${line.amount} ${line.currency} -> ${customer.customer_id} (${line.creditor_account_iban})`;
  }

  return {
    line,
    counter: "deposits",
    transfers,
    successMessage,
  };
}

function findGroupIndexByTransferIndex(groupRanges, transferIndex) {
  for (let index = 0; index < groupRanges.length; index++) {
    const range = groupRanges[index];
    if (transferIndex >= range.start && transferIndex <= range.end) {
      return index;
    }
  }
  return -1;
}

export async function processPendingStatementLines(client, { log = false } = {}) {
  const lines = await getNewStatementLines();
  const stats = {
    total: lines.length,
    deposits: 0,
    bank_settlements: 0,
    bank_interest: 0,
    nominated_withdrawals: 0,
    skipped: 0,
    failed: 0,
    transfer_batches: 0,
    transfer_batch_attempts: 0,
    oversized_batch_splits: 0,
    transfers_posted: 0,
  };

  const transferGroups = [];
  for (const line of lines) {
    try {
      const group = createTransferGroup(line);
      if (group.skipped) {
        stats.skipped += 1;
        if (log) console.log(group.reason);
        continue;
      }
      transferGroups.push(group);
    } catch (error) {
      stats.failed += 1;
      if (log) console.error(`Failed to prepare line ${line.transaction_id}: ${error.message}`);
    }
  }

  if (transferGroups.length === 0) {
    return stats;
  }

  const totalTransfers = transferGroups.reduce((sum, group) => sum + group.transfers.length, 0);
  if (log) {
    console.log(
      `${STATEMENT_LOG_PREFIX} createTransfers groups=${transferGroups.length} transfers=${totalTransfers} max_batch=${STATEMENT_TRANSFER_BATCH_SIZE}`
    );
  }

  let submissions;
  try {
    submissions = await createTransfersForGroupsAdaptive(client, transferGroups, {
      maxItems: STATEMENT_TRANSFER_BATCH_SIZE,
      onBatch: ({ groups, transfers }) => {
        stats.transfer_batch_attempts += 1;
        if (log) {
          console.log(
            `${STATEMENT_LOG_PREFIX} createTransfers batch groups=${groups.length} transfers=${transfers.length}`
          );
        }
      },
      onOversizedSplit: () => {
        stats.oversized_batch_splits += 1;
      },
    });
  } catch (error) {
    stats.failed += transferGroups.length;
    if (log) {
      console.error(`${STATEMENT_LOG_PREFIX} createTransfers failed: ${error.message}`);
    }
    return stats;
  }

  for (const submission of submissions) {
    const { groups: batch, transfers: batchTransfers, errors } = submission;
    const groupRanges = [];
    let offset = 0;
    for (const group of batch) {
      groupRanges.push({ start: offset, end: offset + group.transfers.length - 1 });
      offset += group.transfers.length;
    }
    stats.transfer_batches += 1;

    const groupErrors = new Map();
    for (const err of errors) {
      if (err.result === CreateTransferError.exists) {
        continue;
      }

      const groupIndex = findGroupIndexByTransferIndex(groupRanges, err.index ?? 0);
      const message = formatTransferError(err.result);
      if (groupIndex === -1) {
        if (log) {
          console.error(
            `${STATEMENT_LOG_PREFIX} unassigned error transfer_index=${err.index}: ${message}`
          );
        }
        continue;
      }

      if (!groupErrors.has(groupIndex)) {
        groupErrors.set(groupIndex, new Set());
      }
      groupErrors.get(groupIndex).add(message);
    }

    for (const [groupIndex, group] of batch.entries()) {
      if (groupErrors.has(groupIndex)) {
        stats.failed += 1;
        if (log) {
          console.error(
            `Failed to process line ${group.line.transaction_id}: ${Array.from(groupErrors.get(groupIndex)).join("; ")}`
          );
        }
        continue;
      }

      stats[group.counter] += 1;
      stats.transfers_posted += group.transfers.length;
      if (log) console.log(group.successMessage);
    }
  }

  return stats;
}
