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

  const placementInTransitAccountId = id();
  const principalPlacedAccountId = id();
  const interestDueAccountId = id();
  const redemptionInTransitAccountId = id();
  const placementInTransitAccount = createAccount(
    placementInTransitAccountId,
    AccountCode.ASSET_BANK_PLACEMENT_IN_TRANSIT,
    AccountFlags.linked | AccountFlags.credits_must_not_exceed_debits
  );
  const principalPlacedAccount = createAccount(
    principalPlacedAccountId,
    AccountCode.ASSET_BANK_PRINCIPAL_PLACED,
    AccountFlags.linked | AccountFlags.credits_must_not_exceed_debits
  );
  const interestDueAccount = createAccount(
    interestDueAccountId,
    AccountCode.ASSET_BANK_INTEREST_DUE,
    AccountFlags.credits_must_not_exceed_debits
  );

  const redemptionInTransitAccount = createAccount(
    redemptionInTransitAccountId,
    AccountCode.ASSET_BANK_REDEMPTION_IN_TRANSIT,
    AccountFlags.credits_must_not_exceed_debits
  );

  const errors = await client.createAccounts([placementInTransitAccount, principalPlacedAccount, interestDueAccount, redemptionInTransitAccount]);
  for (const err of errors) {
    if (err.result !== CreateAccountError.exists && err.result !== CreateAccountError.linked_event_failed) {
      throw new Error(formatAccountError(err.result));
    }
  }

  const bank = {
    bank_id: bankId,
    placement_in_transit_account_id: placementInTransitAccountId,
    principal_placed_account_id: principalPlacedAccountId,
    interest_due_account_id: interestDueAccountId,
    redemption_in_transit_account_id: redemptionInTransitAccountId,
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
