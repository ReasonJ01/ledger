import { id, CreateTransferError } from "tigerbeetle-node";
import { formatTransferError } from "./tb-errors.js";
import { AccountId, TransferCode } from "./config.js";
import { amountToScale8, createLinkedTransfers, createTransfer } from "./transfers.js";

export async function processMoneyReceived(client, statementLine) {
  const transferId = BigInt("0x" + statementLine.id);
  const amount = amountToScale8(statementLine.amount);

  const transfer = createTransfer({
    id: transferId,
    debit_account_id: AccountId.CLIENT_MONEY,
    credit_account_id: AccountId.UNATTRIBUTED_RECEIPTS,
    amount,
    code: TransferCode.MONEY_RECEIVED,
  });

  const errors = await client.createTransfers([transfer]);
  for (const err of errors) {
    if (err.result !== CreateTransferError.exists) throw new Error(formatTransferError(err.result));
  }
}

export async function matchToCustomer(client, amountScale8, holdingAccountId, transferId = id()) {
  const transfer = createTransfer({
    id: transferId,
    debit_account_id: AccountId.UNATTRIBUTED_RECEIPTS,
    credit_account_id: BigInt(holdingAccountId),
    amount: BigInt(amountScale8),
    code: TransferCode.CUSTOMER_IDENTIFIED,
  });
  const errors = await client.createTransfers([transfer]);
  if (errors.length > 0) throw new Error(formatTransferError(errors[0].result));
}

export async function allocateToProduct(client, amountScale8, holdingAccountId, productPrincipalAccountId, bankPendingAccountId) {
  const transfers = createLinkedTransfers([
    {
      id: id(),
      debit_account_id: BigInt(holdingAccountId),
      credit_account_id: BigInt(productPrincipalAccountId),
      amount: BigInt(amountScale8),
      code: TransferCode.PRODUCT_PRINCIPAL_ALLOCATED,
    },
    {
      id: id(),
      debit_account_id: BigInt(bankPendingAccountId),
      credit_account_id: AccountId.CLIENT_MONEY,
      amount: BigInt(amountScale8),
      code: TransferCode.PRODUCT_CASH_RESERVED,
    },
  ]);
  const errors = await client.createTransfers(transfers);
  if (errors.length > 0) throw new Error(formatTransferError(errors[0].result));
}

export async function settleToBank(client, amountScale8, bankPendingAccountId, bankSettledAccountId, transferId = id()) {
  const transfer = createTransfer({
    id: transferId,
    debit_account_id: BigInt(bankSettledAccountId),
    credit_account_id: BigInt(bankPendingAccountId),
    amount: BigInt(amountScale8),
    code: TransferCode.BANK_SETTLEMENT,
  });
  const errors = await client.createTransfers([transfer]);
  if (errors.length > 0) throw new Error(formatTransferError(errors[0].result));
}

export async function withdrawToHolding(client, amountScale8, productPrincipalAccountId, holdingAccountId, transferId = id()) {
  const transfer = createTransfer({
    id: transferId,
    debit_account_id: BigInt(productPrincipalAccountId),
    credit_account_id: BigInt(holdingAccountId),
    amount: BigInt(amountScale8),
    code: TransferCode.PRODUCT_WITHDRAWAL_TO_HOLDING,
  });
  const errors = await client.createTransfers([transfer]);
  if (errors.length > 0) throw new Error(formatTransferError(errors[0].result));
}

export async function payOutToNominated(client, amountScale8, holdingAccountId, transferId = id()) {
  const transfer = createTransfer({
    id: transferId,
    debit_account_id: BigInt(holdingAccountId),
    credit_account_id: AccountId.CLIENT_MONEY,
    amount: BigInt(amountScale8),
    code: TransferCode.WITHDRAWAL_TO_NOMINATED,
  });
  const errors = await client.createTransfers([transfer]);
  if (errors.length > 0) throw new Error(formatTransferError(errors[0].result));
}
