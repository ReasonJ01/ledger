import { id } from "tigerbeetle-node";
import { PHYSICAL_ACCOUNT_IBAN } from "../config.js";

let pending = [];

function formatDate() {
  return new Date().toISOString().slice(0, 10);
}

function nextTransferIdHex() {
  return id().toString(16);
}

function createTransferIds(eventType) {
  if (eventType === "BANK_INTEREST") {
    return {
      bank_interest: nextTransferIdHex(),
    };
  }

  if (eventType === "BANK_SETTLEMENT") {
    return {
      bank_settlement: nextTransferIdHex(),
    };
  }

  if (eventType === "CUSTOMER_WITHDRAWAL_NOMINATED") {
    return {
      withdrawal_to_nominated: nextTransferIdHex(),
    };
  }

  return {
    money_received: nextTransferIdHex(),
    customer_identified: nextTransferIdHex(),
  };
}

export async function addStatementLine({
  amount,
  currency = "GBP",
  credit_debit_indicator = "CRDT",
  creditor_account_iban,
  debtor_account_iban = "GB98NWBK60161331926819",
  event_type = "CUSTOMER_DEPOSIT",
  source_bank_id = null,
  source_customer_id = null,
}) {
  const tbId = id();
  const line = {
    id: tbId.toString(16),
    account_iban: PHYSICAL_ACCOUNT_IBAN,
    transaction_id: `TX-${tbId.toString(16).slice(-8).toUpperCase()}`,
    account_servicer_reference: `ASR-${Date.now()}`,
    value_date: formatDate(),
    credit_debit_indicator,
    amount: String(amount),
    currency,
    debtor_account_iban,
    creditor_account_iban: creditor_account_iban ?? "GB77VIBN00000000012345",
    event_type,
    source_bank_id,
    source_customer_id,
    transfer_ids: createTransferIds(event_type),
  };
  pending.push(line);
  return line;
}

export async function getNewStatementLines() {
  const lines = [...pending];
  pending = [];
  return lines;
}
