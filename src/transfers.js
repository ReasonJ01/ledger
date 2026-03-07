import { LEDGER_ID, ASSET_SCALE, TransferFlags } from "./config.js";

export function amountToScale8(amountStr) {
  const [whole, frac = ""] = String(amountStr).split(".");
  const padded = frac.padEnd(ASSET_SCALE, "0").slice(0, ASSET_SCALE);
  return BigInt(whole + padded);
}

export function createTransfer({
  id,
  debit_account_id,
  credit_account_id,
  amount,
  code,
  user_data_128 = 0n,
  flags = 0,
}) {
  return {
    id,
    debit_account_id,
    credit_account_id,
    amount,
    pending_id: 0n,
    user_data_128,
    user_data_64: 0n,
    user_data_32: 0,
    timeout: 0,
    ledger: LEDGER_ID,
    code,
    flags,
    timestamp: 0n,
  };
}

export function createLinkedTransfers(definitions) {
  return definitions.map((definition, index) =>
    createTransfer({
      ...definition,
      flags: index < definitions.length - 1 ? TransferFlags.linked : 0,
    })
  );
}

export function createTransferBatchFromGroups(groups) {
  return groups.flatMap((group) =>
    group.map((transfer, index) => ({
      ...transfer,
      flags: index < group.length - 1 ? transfer.flags | TransferFlags.linked : transfer.flags,
    }))
  );
}
