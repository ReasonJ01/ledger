import {
  AccountFlags as TBAccountFlags,
  TransferFlags as TBTransferFlags,
} from "tigerbeetle-node";

/** Ledger configuration for cash savings aggregator */

export const LEDGER_ID = 1;
export const ASSET_SCALE = 8; // 1 GBP = 10^8 units

export const AccountCode = {
  ASSET_CLIENT_MONEY: 1001,
  ASSET_BANK_PENDING: 1002,
  ASSET_BANK_SETTLED: 1003,
  ASSET_BANK_INTEREST_RECEIVABLE: 1004,
  ASSET_OPERATING_CASH: 1005,
  LIABILITY_UNATTRIBUTED: 2001,
  LIABILITY_HOLDING: 2002,
  LIABILITY_PRODUCT_PRINCIPAL: 2003,
  LIABILITY_ACCRUED_INTEREST: 2004,
  INCOME_FEE: 3001,
};

export const AccountFlags = {
  linked: TBAccountFlags.linked,
  credits_must_not_exceed_debits: TBAccountFlags.credits_must_not_exceed_debits,
  debits_must_not_exceed_credits: TBAccountFlags.debits_must_not_exceed_credits,
};

export const TransferFlags = {
  linked: TBTransferFlags.linked,
};

export const TransferCode = {
  MONEY_RECEIVED: 1,
  CUSTOMER_IDENTIFIED: 2,
  PRODUCT_PRINCIPAL_ALLOCATED: 3,
  PRODUCT_CASH_RESERVED: 4,
  BANK_SETTLEMENT: 5,
  INTEREST_ACCRUAL_CUSTOMER: 6,
  INTEREST_ACCRUAL_FEE: 7,
  INTEREST_REALISATION: 8,
  FEE_COLLECTION: 9,
  PRODUCT_WITHDRAWAL_TO_HOLDING: 10,
  WITHDRAWAL_TO_NOMINATED: 11,
  INTEREST_CAPITALISATION: 12,
};

export const AccountId = {
  CLIENT_MONEY: 0x00000000000000000000000000000001n,
  UNATTRIBUTED_RECEIPTS: 0x00000000000000000000000000000003n,
  OPERATING_CASH: 0x00000000000000000000000000000005n,
  FEE_INCOME: 0x00000000000000000000000000000006n,
};

export const PHYSICAL_ACCOUNT_IBAN = "GB12BARC12345612345678";
