# Cash Savings Aggregator Ledger Demo

Small [TigerBeetle](https://tigerbeetle.com/) demo for a cash savings aggregator.

- customer money arrives into one pooled physical account
- virtual IBANs are used to identify who paid in
- matched cash sits in customer available cash
- customers allocate available cash into savings products
- product allocations and redemptions flow through explicit in-progress states
- nominated withdrawals are requested first, then settled from statement lines
- money is placed with partner banks and later confirmed from statements
- customer interest and platform fee income are tracked separately

## Debits, Credits, Assets, and Liabilities

TigerBeetle is built around accounts and transfers, so a useful thing to keep in mind while reading this demo is that a debit or credit does not mean the same thing on every account. It depends on whether the account is an asset or liability.

- for asset accounts, balance is `debits - credits`
- for liability accounts, balance is `credits - debits`

## Recommended TigerBeetle Reading

If you want a bit more background before walking through the code, the first few articles in TigerBeetle's Coding section are worth reading:

- [Coding Overview](https://docs.tigerbeetle.com/coding/)
- [Data Modeling](https://docs.tigerbeetle.com/coding/data-modeling/)
- [Financial Accounting](https://docs.tigerbeetle.com/coding/financial-accounting/)

You can get up to some [pretty funky things](https://docs.tigerbeetle.com/coding/recipes/) once you get a handle on the different patterns available for adding transfers.

## Ledger Model

Fyi, i think the actual shape of the ledger here is *not great*. There's probably a much nicer one out there you could find with some extra knowledge and effort.

### System assets

- `Safeguard pooled cash`: cash in the pooled physical account
- `BANK_X cash pending placement`: cash reserved for partner placement but not yet bank-settled
- `BANK_X cash at bank`: cash confirmed as placed with the partner bank
- `BANK_X interest receivable`: accrued interest due back from that partner bank
- `Operating cash`: fees collected out of pooled cash

### Customer liabilities

- `Unidentified receipts`: inbound money before virtual IBAN matching
- `cust_N available cash`: identified customer cash still on-platform
- `cust_N withdrawal in progress`: nominated withdrawal requested, awaiting statement settlement
- `cust_N PRODUCT_X subscription in progress`: subscription state before confirmation
- `cust_N PRODUCT_X principal invested`: invested product balance
- `cust_N PRODUCT_X interest accrued`: accrued customer interest before capitalisation
- `cust_N PRODUCT_X redemption in progress`: redemption state before completion

### Income

- `Fee income`: platform earned share of product interest accrual

## Flow

### 1. Money received into safeguard pooled cash

Statement credit arrives:

- Debit `Safeguard pooled cash`
- Credit `Unidentified receipts`

If the virtual IBAN matches a customer in the same processing pass:

- Debit `Unidentified receipts`
- Credit `cust_N available cash`

### 2. Customer allocates into a product

This is one linked TigerBeetle batch with three transfers:

- Debit `cust_N available cash`
- Credit `cust_N PRODUCT_X subscription in progress`
- Debit `cust_N PRODUCT_X subscription in progress`
- Credit `cust_N PRODUCT_X principal invested`
- Debit `BANK_X cash pending placement`
- Credit `Safeguard pooled cash`

This keeps customer liability movement and asset reservation aligned atomically.

### 3. Placement confirmed with the partner bank

A simulated settlement statement debit (`event_type = "BANK_SETTLEMENT"`, `source_bank_id = "BANK_X"`) is processed as:

- Debit `BANK_X cash at bank`
- Credit `BANK_X cash pending placement`

### 4. Bank end-of-day accrual and customer interest capitalisation

Accrual per product at a bank posts:

- Debit `BANK_X interest receivable`
- Credit `cust_N PRODUCT_X interest accrued`
- Credit `Fee income`

Accrual compounds daily on `principal invested + interest accrued`.

In the same run, whole pennies of customer interest are capitalised:

- Debit `cust_N PRODUCT_X interest accrued`
- Credit `cust_N PRODUCT_X principal invested`

Sub-penny customer interest remains in `interest accrued`.

### 5. Bank interest cash received via statement line

When the bank pays interest (`event_type = "BANK_INTEREST"`, `source_bank_id = "BANK_X"`):

- Debit `Safeguard pooled cash`
- Credit `BANK_X interest receivable`

### 6. Fee collection

When fees are collected:

- Debit `Operating cash`
- Credit `Safeguard pooled cash`

### 7. Customer redemption back to available cash

`Product -> Available cash` redemption is linked in two legs:

- Debit `cust_N PRODUCT_X principal invested`
- Credit `cust_N PRODUCT_X redemption in progress`
- Debit `cust_N PRODUCT_X redemption in progress`
- Credit `cust_N available cash`

### 8. Customer nominated withdrawal

First, withdrawal is requested:

- Debit `cust_N available cash`
- Credit `cust_N withdrawal in progress`

Then a nominated withdrawal statement debit (`event_type = "CUSTOMER_WITHDRAWAL_NOMINATED"`, `source_customer_id = "cust_N"`) settles:

- Debit `cust_N withdrawal in progress`
- Credit `Safeguard pooled cash`

## TigerBeetle Features Used In This Demo

### 1. Linked transfer chains (atomic multi-leg posting)

What it is:
TigerBeetle lets us mark transfer events as `linked` so a whole chain either commits together or fails together.

How this demo uses it:

- Product allocation posts three legs in one atomic chain:
  - available cash -> subscription in progress
  - subscription in progress -> principal invested
  - bank placement in transit -> safeguard pooled cash
- Product redemption posts two legs in one atomic chain:
  - principal invested -> redemption in progress
  - redemption in progress -> available cash
- Transfer linking is encoded in `TransferFlags.linked` and applied by `createLinkedTransfers()` / `createTransferBatchFromGroups()`.

Why it is useful here:
These flows have intermediate state accounts. Linking prevents partial progress where one leg posts but another does not, which would otherwise desynchronise customer liabilities from platform assets.

### 2. Linked account creation (atomic account provisioning)

What it is:
The same `linked` idea can be applied when creating accounts.

How this demo uses it:

- Customer provisioning links creation of `available_cash` and `withdrawal_in_progress`.
- Bank provisioning links a chain of core accounts (`cash pending placement` -> `cash at bank` -> `interest due`) so they are created as one atomic unit.
- The code accepts `linked_event_failed` as an expected cascade result when one item in a linked create fails.

Why it is useful here:
We avoid half-created entities (for example, a customer with available cash but no withdrawal account), which simplifies operational recovery and keeps object state consistent.

### 3. Balance-limit flags on accounts (ledger-level invariants)

What it is:
TigerBeetle account flags enforce balance constraints at write time.

How this demo uses it:

- Asset accounts use `credits_must_not_exceed_debits`.
- Liability and income accounts use `debits_must_not_exceed_credits`.
- These flags are set at account creation and validated by TigerBeetle on every transfer.

Why it is useful here:
The accounting rules are enforced inside the ledger engine itself, not only in app code, reducing the chance of invalid states under retries, race conditions, or future code changes.

### 4. Idempotent submission with stable transfer IDs

What it is:
TigerBeetle rejects duplicate transfer IDs with `CreateTransferError.exists`.

How this demo uses it:

- Statement simulator lines generate transfer IDs up front and store them in `transfer_ids`.
- Reactor processing reuses those exact IDs when posting.
- Retry paths treat `exists` as success-equivalent.

Why it is useful here:
Statement processing is naturally retry-heavy. Stable IDs guarantee "at most once" money movement even if the same line is replayed.

### 5. High-throughput batched writes with adaptive split

What it is:
TigerBeetle is designed for batched operations; this demo submits grouped transfers in batches.

How this demo uses it:

- Interest accrual, statement processing, and load-mode direct transfers all post via batch helpers.
- If a batch is too large ("Too much data provided on this batch"), the helper splits the batch recursively and retries.
- Batching is done by business group so linked chains stay intact.

Why it is useful here:
We preserve throughput under bursty workloads without sacrificing atomic group semantics.

### 6. Batched account lookups for balance-heavy operations

What it is:
Read-side work can also be batched by chunking `lookupAccounts` requests.

How this demo uses it:

- Balance views and accrual preparation collect many account IDs, chunk them, then call `lookupAccounts` per chunk.
- Account balances are then derived from posted debit/credit totals in memory.

Why it is useful here:
Large read sets are processed predictably and avoid fragile "one request per account" behavior.

### 7. Structured transfer metadata (`code`, `user_data_128`)

What it is:
TigerBeetle transfer records include typed classification fields and user-defined metadata.

How this demo uses it:

- `TransferCode` classifies each movement (money received, customer identified, accrual, fee, settlement, withdrawal, etc.).
- Statement-driven transfers store statement reference IDs in `user_data_128`.

Why it is useful here:
This gives clean auditability: each posted movement has both business meaning and source-event correlation.
## Notes On `src/config.js`

`src/config.js` is effectively the shared ledger vocabulary for the demo, so a lot of the rest of the code makes more sense once you know what is defined there.

- `LEDGER_ID = 1` means everything in this demo is posted into a single TigerBeetle ledger. Transfers cannot happen between ledgers.
- `ASSET_SCALE = 8` means amounts are stored as integer scale-8 values. So `1 GBP` is `100000000` internal units.
- `AccountCode` is the chart of accounts. Grouping is:
  - `100x` for assets
  - `200x` for liabilities
  - `300x` for income
- Asset account codes cover:
  - safeguard pooled cash
  - bank placement in transit
  - bank principal placed
  - bank interest due/receivable
  - operating cash
  - bank redemption in transit (provisioned)
- Liability account codes cover:
  - unidentified receipts
  - available cash
  - withdrawal in progress
  - product subscription in progress
  - product principal invested
  - product interest accrued
  - product redemption in progress
- `AccountFlags` uses:
  - `credits_must_not_exceed_debits` for asset accounts
  - `debits_must_not_exceed_credits` for liability and income accounts
  - `linked` where account creation must succeed together
- `TransferCode` is the transaction taxonomy so each posted transfer has explicit business meaning.
- `AccountId` defines fixed system accounts that always exist:
  - `SAFEGUARD_POOLED_CASH`
  - `UNIDENTIFIED_RECEIPTS`
  - `OPERATING_CASH`
  - `FEE_INCOME`
- `PHYSICAL_ACCOUNT_IBAN` is the single pooled real-world account used by the simulator.

## Prerequisites

- Node.js >= 18
- Windows / PowerShell for the provided TigerBeetle script

## Setup

```bash
npm install
```

## Run TigerBeetle

In one terminal:

```bash
npm run start-tb
```

This resets `data/0_0.tigerbeetle`, formats a fresh single-replica cluster, and starts TigerBeetle on port `3000`.

On Linux or macOS use:

```bash
npm run start-tb-unix
```

## Run The Demo

In another terminal:

```bash
npm start
```

Then open `http://localhost:8080`.

Load simulator UI: `http://localhost:8080/load.html`

For CLI mode:

```bash
node src/main.js cli
```

## CLI Example

```text
> create-bank BANK_A
> create-product PRODUCT_A BANK_A EASY_ACCESS 0.0400 0.15
> create-customer
> open-product cust_1 PRODUCT_A
> inject 100.00 cust_1
> deposit cust_1 PRODUCT_A 100.00
> settle BANK_A
> accrue-interest BANK_A
> realise-interest BANK_A
> collect-fees
> balances
```

## Web UI Actions

- create customers, banks, and products
- open a product for a customer
- inject inbound payments via statement simulation
- allocate customer available cash into a product
- confirm partner bank placement from pending to placed
- run bank EOD accrual (including customer capitalisation)
- simulate bank interest payment through statement lines
- withdraw from product back into available cash
- request and settle nominated withdrawals
- run load traffic from the dedicated load UI
- collect fees into operating cash
