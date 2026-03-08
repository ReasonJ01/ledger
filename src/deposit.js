import { id, CreateTransferError } from "tigerbeetle-node";
import { formatTransferError } from "./tb-errors.js";
import { AccountId, TransferCode } from "./config.js";
import { amountToScale8, createLinkedTransfers, createTransfer } from "./transfers.js";

export async function processMoneyReceived(client, statementLine) {
  const transferId = BigInt("0x" + statementLine.id);
  const amount = amountToScale8(statementLine.amount);

  const transfer = createTransfer({
    id: transferId,
    debit_account_id: AccountId.SAFEGUARD_POOLED_CASH,
    credit_account_id: AccountId.UNIDENTIFIED_RECEIPTS,
    amount,
    code: TransferCode.MONEY_RECEIVED,
  });

  const errors = await client.createTransfers([transfer]);
  for (const err of errors) {
    if (err.result !== CreateTransferError.exists) throw new Error(formatTransferError(err.result));
  }
}

export async function matchToCustomer(client, amountScale8, availableCashAccountId, transferId = id()) {
  const transfer = createTransfer({
    id: transferId,
    debit_account_id: AccountId.UNIDENTIFIED_RECEIPTS,
    credit_account_id: BigInt(availableCashAccountId),
    amount: BigInt(amountScale8),
    code: TransferCode.CUSTOMER_IDENTIFIED,
  });
  const errors = await client.createTransfers([transfer]);
  if (errors.length > 0) throw new Error(formatTransferError(errors[0].result));
}

export async function allocateToProduct(client, amountScale8, availableCashAccountId, subscriptionInProgressAccountId, principalInvestedAccountId, placementInTransitAccountId) {
  const transfers = createLinkedTransfers([
    {
      id: id(),
      debit_account_id: BigInt(availableCashAccountId),
      credit_account_id: BigInt(subscriptionInProgressAccountId),
      amount: BigInt(amountScale8),
      code: TransferCode.PRODUCT_SUBSCRIPTION_REQUESTED,
    },
    {
      id: id(),
      debit_account_id: BigInt(subscriptionInProgressAccountId),
      credit_account_id: BigInt(principalInvestedAccountId),
      amount: BigInt(amountScale8),
      code: TransferCode.PRODUCT_SUBSCRIPTION_CONFIRMED,
    },
    {
      id: id(),
      debit_account_id: BigInt(placementInTransitAccountId),
      credit_account_id: AccountId.SAFEGUARD_POOLED_CASH,
      amount: BigInt(amountScale8),
      code: TransferCode.BANK_PLACEMENT_CONFIRMED,
    },
  ]);
  const errors = await client.createTransfers(transfers);
  if (errors.length > 0) throw new Error(formatTransferError(errors[0].result));
}

export async function settleToBank(client, amountScale8, placementInTransitAccountId, principalPlacedAccountId, transferId = id()) {
  const transfer = createTransfer({
    id: transferId,
    debit_account_id: BigInt(principalPlacedAccountId),
    credit_account_id: BigInt(placementInTransitAccountId),
    amount: BigInt(amountScale8),
    code: TransferCode.BANK_PLACEMENT_CONFIRMED,
  });
  const errors = await client.createTransfers([transfer]);
  if (errors.length > 0) throw new Error(formatTransferError(errors[0].result));
}

export async function withdrawToHolding(client, amountScale8, principalInvestedAccountId, redemptionInProgressAccountId, availableCashAccountId, transferId = id()) {
  const transfers = createLinkedTransfers([
    {
      id: transferId,
      debit_account_id: BigInt(principalInvestedAccountId),
      credit_account_id: BigInt(redemptionInProgressAccountId),
      amount: BigInt(amountScale8),
      code: TransferCode.PRODUCT_REDEMPTION_REQUESTED,
    },
    {
      id: id(),
      debit_account_id: BigInt(redemptionInProgressAccountId),
      credit_account_id: BigInt(availableCashAccountId),
      amount: BigInt(amountScale8),
      code: TransferCode.PRODUCT_REDEMPTION_COMPLETED,
    },
  ]);
  const errors = await client.createTransfers(transfers);
  if (errors.length > 0) throw new Error(formatTransferError(errors[0].result));
}

export async function requestWithdrawal(client, amountScale8, availableCashAccountId, withdrawalInProgressAccountId, transferId = id()) {
  const transfer = createTransfer({
    id: transferId,
    debit_account_id: BigInt(availableCashAccountId),
    credit_account_id: BigInt(withdrawalInProgressAccountId),
    amount: BigInt(amountScale8),
    code: TransferCode.WITHDRAWAL_REQUESTED,
  });
  const errors = await client.createTransfers([transfer]);
  if (errors.length > 0) throw new Error(formatTransferError(errors[0].result));
}
