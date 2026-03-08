import { id } from "tigerbeetle-node";
import { CreateAccountError } from "tigerbeetle-node";
import { formatAccountError } from "./tb-errors.js";
import { LEDGER_ID, AccountCode, AccountFlags } from "./config.js";
import { getProductById } from "./products.js";

const VIRTUAL_IBAN_PREFIX = "GB77VIBN";

const byVirtualIban = new Map();
const byCustomerId = new Map();
let customerIndex = 0;

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

export async function createCustomer(client) {
  customerIndex += 1;
  const customerId = `cust_${customerIndex}`;
  const virtualIban = `${VIRTUAL_IBAN_PREFIX}${String(customerIndex).padStart(14, "0")}`;

  const availableCashAccountId = id();
  const withdrawalInProgressAccountId = id();

  const availableCashAccount = createAccount(
    availableCashAccountId,
    AccountCode.LIABILITY_AVAILABLE_CASH,
    AccountFlags.linked | AccountFlags.debits_must_not_exceed_credits
  );
  const withdrawalInProgressAccount = createAccount(
    withdrawalInProgressAccountId,
    AccountCode.LIABILITY_WITHDRAWAL_IN_PROGRESS,
    AccountFlags.debits_must_not_exceed_credits
  );

  const errors = await client.createAccounts([availableCashAccount, withdrawalInProgressAccount]);
  for (const err of errors) {
    if (err.result !== CreateAccountError.exists && err.result !== CreateAccountError.linked_event_failed) {
      throw new Error(formatAccountError(err.result, err.index));
    }
  }

  const customer = {
    customer_id: customerId,
    virtual_iban: virtualIban,
    available_cash_account_id: availableCashAccountId,
    withdrawal_in_progress_account_id: withdrawalInProgressAccountId,
    product_positions: {},
  };

  byVirtualIban.set(virtualIban, customer);
  byCustomerId.set(customerId, customer);

  return customer;
}

export async function openProductAccount(client, customerId, productId) {
  const customer = byCustomerId.get(customerId);
  if (!customer) throw new Error(`Customer ${customerId} not found`);
  if (customer.product_positions[productId]) throw new Error(`${customerId} already has ${productId}`);

  const product = getProductById(productId);
  if (!product) throw new Error(`Product ${productId} not found`);

  const subscriptionInProgressAccountId = id();
  const principalInvestedAccountId = id();
  const interestAccruedAccountId = id();
  const redemptionInProgressAccountId = id();

  const subscriptionInProgressAccount = createAccount(
    subscriptionInProgressAccountId,
    AccountCode.LIABILITY_PRODUCT_SUBSCRIPTION_IN_PROGRESS,
    AccountFlags.debits_must_not_exceed_credits
  );
  const principalInvestedAccount = createAccount(
    principalInvestedAccountId,
    AccountCode.LIABILITY_PRODUCT_PRINCIPAL_INVESTED,
    AccountFlags.debits_must_not_exceed_credits
  );
  const interestAccruedAccount = createAccount(
    interestAccruedAccountId,
    AccountCode.LIABILITY_PRODUCT_INTEREST_ACCRUED,
    AccountFlags.debits_must_not_exceed_credits
  );
  const redemptionInProgressAccount = createAccount(
    redemptionInProgressAccountId,
    AccountCode.LIABILITY_PRODUCT_REDEMPTION_IN_PROGRESS,
    AccountFlags.debits_must_not_exceed_credits
  );

  const errors = await client.createAccounts([
    subscriptionInProgressAccount,
    principalInvestedAccount,
    interestAccruedAccount,
    redemptionInProgressAccount,
  ]);
  for (const err of errors) {
    if (err.result !== CreateAccountError.exists && err.result !== CreateAccountError.linked_event_failed) {
      throw new Error(formatAccountError(err.result));
    }
  }

  customer.product_positions[productId] = {
    subscription_in_progress_account_id: subscriptionInProgressAccountId,
    principal_invested_account_id: principalInvestedAccountId,
    interest_accrued_account_id: interestAccruedAccountId,
    redemption_in_progress_account_id: redemptionInProgressAccountId,
  };
  return customer.product_positions[productId];
}

export function getCustomerByVirtualIban(virtualIban) {
  return byVirtualIban.get(virtualIban) ?? null;
}

export function getCustomerById(customerId) {
  return byCustomerId.get(customerId) ?? null;
}

export function getAllCustomers() {
  return Array.from(byVirtualIban.values());
}
