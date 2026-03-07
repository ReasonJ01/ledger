import { CreateAccountError } from "tigerbeetle-node";
import { formatAccountError } from "./tb-errors.js";
import {
  LEDGER_ID,
  AccountCode,
  AccountId,
} from "./config.js";

import { AccountFlags } from "./config.js";

function createAccount(id, code, flags) {
  return {
    id,
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

export const accounts = [
  createAccount(AccountId.CLIENT_MONEY, AccountCode.ASSET_CLIENT_MONEY, AccountFlags.credits_must_not_exceed_debits),
  createAccount(AccountId.UNATTRIBUTED_RECEIPTS, AccountCode.LIABILITY_UNATTRIBUTED, AccountFlags.debits_must_not_exceed_credits),
  createAccount(AccountId.OPERATING_CASH, AccountCode.ASSET_OPERATING_CASH, AccountFlags.credits_must_not_exceed_debits),
  createAccount(AccountId.FEE_INCOME, AccountCode.INCOME_FEE, AccountFlags.debits_must_not_exceed_credits),
];

export async function ensureAccounts(client) {
  const errors = await client.createAccounts(accounts);
  for (const err of errors) {
    if (err.result !== CreateAccountError.exists && err.result !== CreateAccountError.linked_event_failed) {
      throw new Error(formatAccountError(err.result, err.index));
    }
  }
}
