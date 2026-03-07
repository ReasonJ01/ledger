/**
 * Human-readable messages for TigerBeetle error codes.
 * Based on https://docs.tigerbeetle.com/reference/requests/create_accounts
 * and https://docs.tigerbeetle.com/reference/requests/create_transfers
 */

import { CreateAccountError, CreateTransferError } from "tigerbeetle-node";

const accountMessages = {
  [CreateAccountError.linked_event_failed]: "Account creation failed: another account in the linked chain is invalid",
  [CreateAccountError.linked_event_chain_open]: "Account creation failed: linked flag cannot be set on the last item in a batch",
  [CreateAccountError.imported_event_expected]: "Account creation failed: batch mixes imported and non-imported accounts",
  [CreateAccountError.imported_event_not_expected]: "Account creation failed: batch mixes imported and non-imported accounts",
  [CreateAccountError.timestamp_must_be_zero]: "Account creation failed: timestamp must be zero (cluster sets it)",
  [CreateAccountError.imported_event_timestamp_out_of_range]: "Account creation failed: imported timestamp out of range",
  [CreateAccountError.imported_event_timestamp_must_not_advance]: "Account creation failed: imported timestamp must be in the past",
  [CreateAccountError.imported_event_timestamp_must_not_regress]: "Account creation failed: imported timestamp must not regress",
  [CreateAccountError.reserved_field]: "Account creation failed: reserved field must be zero",
  [CreateAccountError.reserved_flag]: "Account creation failed: reserved flag must be zero",
  [CreateAccountError.id_must_not_be_zero]: "Account creation failed: account ID cannot be zero",
  [CreateAccountError.id_must_not_be_int_max]: "Account creation failed: account ID cannot be max value",
  [CreateAccountError.exists_with_different_flags]: "Account already exists with different flags (reset the database to fix)",
  [CreateAccountError.exists_with_different_user_data_128]: "Account already exists with different user_data_128",
  [CreateAccountError.exists_with_different_user_data_64]: "Account already exists with different user_data_64",
  [CreateAccountError.exists_with_different_user_data_32]: "Account already exists with different user_data_32",
  [CreateAccountError.exists_with_different_ledger]: "Account already exists with different ledger",
  [CreateAccountError.exists_with_different_code]: "Account already exists with different code",
  [CreateAccountError.exists]: "Account already exists",
  [CreateAccountError.flags_are_mutually_exclusive]: "Account creation failed: invalid combination of flags (credits_must_not_exceed_debits and debits_must_not_exceed_credits are mutually exclusive)",
  [CreateAccountError.debits_pending_must_be_zero]: "Account creation failed: debits_pending must be zero",
  [CreateAccountError.debits_posted_must_be_zero]: "Account creation failed: debits_posted must be zero",
  [CreateAccountError.credits_pending_must_be_zero]: "Account creation failed: credits_pending must be zero",
  [CreateAccountError.credits_posted_must_be_zero]: "Account creation failed: credits_posted must be zero",
  [CreateAccountError.ledger_must_not_be_zero]: "Account creation failed: ledger must not be zero",
  [CreateAccountError.code_must_not_be_zero]: "Account creation failed: code must not be zero",
};

const transferMessages = {
  [CreateTransferError.linked_event_failed]: "Transfer failed: another transfer in the linked chain is invalid",
  [CreateTransferError.linked_event_chain_open]: "Transfer failed: linked flag cannot be set on the last item in a batch",
  [CreateTransferError.imported_event_expected]: "Transfer failed: batch mixes imported and non-imported transfers",
  [CreateTransferError.imported_event_not_expected]: "Transfer failed: batch mixes imported and non-imported transfers",
  [CreateTransferError.timestamp_must_be_zero]: "Transfer failed: timestamp must be zero",
  [CreateTransferError.imported_event_timestamp_out_of_range]: "Transfer failed: imported timestamp out of range",
  [CreateTransferError.imported_event_timestamp_must_not_advance]: "Transfer failed: imported timestamp must be in the past",
  [CreateTransferError.reserved_flag]: "Transfer failed: reserved flag must be zero",
  [CreateTransferError.id_must_not_be_zero]: "Transfer failed: transfer ID cannot be zero",
  [CreateTransferError.id_must_not_be_int_max]: "Transfer failed: transfer ID cannot be max value",
  [CreateTransferError.exists_with_different_flags]: "Transfer already exists with different flags",
  [CreateTransferError.exists_with_different_pending_id]: "Transfer already exists with different pending_id",
  [CreateTransferError.exists_with_different_timeout]: "Transfer already exists with different timeout",
  [CreateTransferError.exists_with_different_debit_account_id]: "Transfer already exists with different debit account",
  [CreateTransferError.exists_with_different_credit_account_id]: "Transfer already exists with different credit account",
  [CreateTransferError.exists_with_different_amount]: "Transfer already exists with different amount",
  [CreateTransferError.exists_with_different_user_data_128]: "Transfer already exists with different user_data_128",
  [CreateTransferError.exists_with_different_user_data_64]: "Transfer already exists with different user_data_64",
  [CreateTransferError.exists_with_different_user_data_32]: "Transfer already exists with different user_data_32",
  [CreateTransferError.exists_with_different_ledger]: "Transfer already exists with different ledger",
  [CreateTransferError.exists_with_different_code]: "Transfer already exists with different code",
  [CreateTransferError.exists]: "Transfer already exists (idempotent retry)",
  [CreateTransferError.id_already_failed]: "Transfer failed previously with this ID; use a new ID to retry",
  [CreateTransferError.flags_are_mutually_exclusive]: "Transfer failed: invalid combination of flags",
  [CreateTransferError.debit_account_id_must_not_be_zero]: "Transfer failed: debit account ID cannot be zero",
  [CreateTransferError.debit_account_id_must_not_be_int_max]: "Transfer failed: debit account ID cannot be max value",
  [CreateTransferError.credit_account_id_must_not_be_zero]: "Transfer failed: credit account ID cannot be zero",
  [CreateTransferError.credit_account_id_must_not_be_int_max]: "Transfer failed: credit account ID cannot be max value",
  [CreateTransferError.accounts_must_be_different]: "Transfer failed: debit and credit accounts must be different",
  [CreateTransferError.pending_id_must_be_zero]: "Transfer failed: pending_id must be zero for non-pending transfers",
  [CreateTransferError.pending_id_must_not_be_zero]: "Transfer failed: pending_id required for this transfer type",
  [CreateTransferError.pending_id_must_not_be_int_max]: "Transfer failed: pending_id cannot be max value",
  [CreateTransferError.pending_id_must_be_different]: "Transfer failed: pending_id must differ from transfer id",
  [CreateTransferError.timeout_reserved_for_pending_transfer]: "Transfer failed: timeout only applies to pending transfers",
  [CreateTransferError.ledger_must_not_be_zero]: "Transfer failed: ledger must not be zero",
  [CreateTransferError.code_must_not_be_zero]: "Transfer failed: code must not be zero",
  [CreateTransferError.debit_account_not_found]: "Transfer failed: debit account does not exist",
  [CreateTransferError.credit_account_not_found]: "Transfer failed: credit account does not exist",
  [CreateTransferError.accounts_must_have_the_same_ledger]: "Transfer failed: both accounts must use the same ledger",
  [CreateTransferError.transfer_must_have_the_same_ledger_as_accounts]: "Transfer failed: transfer ledger must match accounts",
  [CreateTransferError.pending_transfer_not_found]: "Transfer failed: pending transfer not found",
  [CreateTransferError.pending_transfer_not_pending]: "Transfer failed: referenced transfer is not pending",
  [CreateTransferError.pending_transfer_has_different_debit_account_id]: "Transfer failed: pending transfer has different debit account",
  [CreateTransferError.pending_transfer_has_different_credit_account_id]: "Transfer failed: pending transfer has different credit account",
  [CreateTransferError.pending_transfer_has_different_ledger]: "Transfer failed: pending transfer has different ledger",
  [CreateTransferError.pending_transfer_has_different_code]: "Transfer failed: pending transfer has different code",
  [CreateTransferError.exceeds_credits]: "Transfer failed: would exceed credit account limit (insufficient balance)",
  [CreateTransferError.exceeds_debits]: "Transfer failed: would exceed debit account limit",
  [CreateTransferError.pending_transfer_already_posted]: "Transfer failed: pending transfer was already posted",
  [CreateTransferError.pending_transfer_already_voided]: "Transfer failed: pending transfer was already voided",
  [CreateTransferError.pending_transfer_expired]: "Transfer failed: pending transfer has expired",
  [CreateTransferError.credit_account_already_closed]: "Transfer failed: credit account is closed",
  [CreateTransferError.debit_account_already_closed]: "Transfer failed: debit account is closed",
  [CreateTransferError.closing_transfer_must_be_pending]: "Transfer failed: closing transfer must reference a pending transfer",
};

function formatAccountError(result, index) {
  const msg = accountMessages[result];
  if (msg) return index !== undefined ? `${msg} (at index ${index})` : msg;
  return `Account creation failed: ${result}${index !== undefined ? ` at index ${index}` : ""}`;
}

function formatTransferError(result) {
  const msg = transferMessages[result];
  return msg || `Transfer failed: ${result}`;
}

export { formatAccountError, formatTransferError };
