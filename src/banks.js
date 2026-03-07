import { id } from "tigerbeetle-node";
import { CreateAccountError } from "tigerbeetle-node";
import { formatAccountError } from "./tb-errors.js";
import { LEDGER_ID, AccountCode, AccountFlags } from "./config.js";

const byBankId = new Map();

function createAccount(accountId, code, flags) {
  return {
    id: accountId,
    debits_pending: 0n,
    debits_posted: 0n,
    credits_pending: 0n,
    credits_posted: 0n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    reserved: 0,
    ledger: LEDGER_ID,
    code,
    flags,
    timestamp: 0n,
  };
}

export async function createBank(client, bankId) {
  if (byBankId.has(bankId)) throw new Error(`Bank ${bankId} already exists`);

  const pendingAccountId = id();
  const settledAccountId = id();
  const interestReceivableAccountId = id();
  const pendingAccount = createAccount(
    pendingAccountId,
    AccountCode.ASSET_BANK_PENDING,
    AccountFlags.linked | AccountFlags.credits_must_not_exceed_debits
  );
  const settledAccount = createAccount(
    settledAccountId,
    AccountCode.ASSET_BANK_SETTLED,
    AccountFlags.linked | AccountFlags.credits_must_not_exceed_debits
  );
  const interestReceivableAccount = createAccount(
    interestReceivableAccountId,
    AccountCode.ASSET_BANK_INTEREST_RECEIVABLE,
    AccountFlags.credits_must_not_exceed_debits
  );

  const errors = await client.createAccounts([pendingAccount, settledAccount, interestReceivableAccount]);
  for (const err of errors) {
    if (err.result !== CreateAccountError.exists && err.result !== CreateAccountError.linked_event_failed) {
      throw new Error(formatAccountError(err.result));
    }
  }

  const bank = {
    bank_id: bankId,
    pending_account_id: pendingAccountId,
    settled_account_id: settledAccountId,
    interest_receivable_account_id: interestReceivableAccountId,
  };
  byBankId.set(bankId, bank);
  return bank;
}

export function getBankById(bankId) {
  return byBankId.get(bankId) ?? null;
}

export function getAllBanks() {
  return Array.from(byBankId.values());
}
