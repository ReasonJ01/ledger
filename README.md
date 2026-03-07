# Cash Savings Aggregator Ledger Demo

Small [TigerBeetle](https://tigerbeetle.com/) demo for a cash savings aggregator.

- customer money arrives into one pooled physical account
- virtual IBANs are used to identify who paid in
- matched cash sits in a customer holding balance
- customers allocate from holding into savings products
- customers can withdraw from products back into holding
- customers can withdraw from holding to their nominated account
- money is then placed with partner banks
- interest owed to customers and platform fees are tracked separately from principal

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

- `Client money pool`: cash in the pooled physical account
- `BANK_X cash pending placement`: cash reserved for a partner bank but not yet confirmed as placed
- `BANK_X cash at bank`: cash confirmed as placed with the partner bank
- `BANK_X interest receivable`: accrued interest due back from that partner bank
- `Operating cash`: fees collected out of interest

### Customer liabilities

- `Unattributed receipts`: inbound money before a virtual IBAN match
- `cust_N holding`: identified customer cash still on-platform
- `cust_N PRODUCT_X principal`: amount allocated into the savings product
- `cust_N PRODUCT_X interest payable`: accrued interest owed to the customer before it is capitalised into principal

### Income

- `Fee income`: the platform's earned share of product interest

## Flow

### 1. Money received into the pooled account

Bank statement credit arrives:

- Debit `Client money pool`
- Credit `Unattributed receipts`

### 2. Customer identified from the virtual IBAN

The receipt is matched to a customer:

- Debit `Unattributed receipts`
- Credit `cust_N holding`

### 3. Customer allocates into a product

This is a linked TigerBeetle batch with two transfers:

- Debit `cust_N holding`
- Credit `cust_N PRODUCT_X principal`
- Debit `BANK_X cash pending placement`
- Credit `Client money pool`

This keeps the customer-side move and the cash-side reservation atomic.

### 4. Placement confirmed with the partner bank

In this demo, the sweep is simulated by creating a statement line debit (`event_type = "BANK_SETTLEMENT"`, `source_bank_id = "BANK_X"`). The reactor then posts:

- Debit `BANK_X cash at bank`
- Credit `BANK_X cash pending placement`

Customer liabilities do not move here because the customer already owned the product balance after step 3.

### 5. Bank end-of-day accrual and customer interest realisation

After the bank's physical movements are complete, run accrual for that bank:

- Debit `BANK_X interest receivable`
- Credit `cust_N PRODUCT_X interest payable`
- Credit `Fee income`

The customer amount and fee amount are split using the product's `fee_share`.
Accrual compounds daily because each day is calculated on `principal + accrued interest payable`.

In the same run, any whole pennies of customer interest are realised into principal:

- Debit `cust_N PRODUCT_X interest payable`
- Credit `cust_N PRODUCT_X principal`

Sub-penny customer interest stays accrued in `interest payable` until it reaches a real amount of currency.

### 6. Bank interest cash received via statement line

When the bank actually pays interest:

- Debit `Client money pool`
- Credit `BANK_X interest receivable`

In this demo, this happens through the statement simulator with `event_type = "BANK_INTEREST"` and `source_bank_id = "BANK_X"`, then the reactor posts the realization transfer.

### 7. Fee collection

When fees are taken out of pooled cash:

- Debit `Operating cash`
- Credit `Client money pool`

### 8. Customer withdrawals

`Product -> Holding` withdrawal:

- Debit `cust_N PRODUCT_X principal`
- Credit `cust_N holding`

`Holding -> Nominated` withdrawal:

- Simulated as a statement debit (`event_type = "CUSTOMER_WITHDRAWAL_NOMINATED"`, `source_customer_id = "cust_N"`)
- Reactor posts: Debit `cust_N holding`, Credit `Client money pool`

## TigerBeetle Features Used In This Demo

- Linked events are the most important one here. They let one business action post multiple ledger effects atomically. In this demo, allocating to a product moves `holding -> principal` and `client money -> bank pending` in the same linked batch, so customer balances and cash reservation cannot drift apart. Used in `src/deposit.js` and linked account creation in `src/customers.js`.
- Account flags and balance constraints are useful because this model mixes assets, liabilities, and income. Customer liability accounts should fail differently from cash asset accounts, and TigerBeetle lets us encode that at the account level. Used in `src/config.js`, `src/accounts.js`, `src/customers.js`, and `src/banks.js`.
- Idempotent transfer submission matters because statement processing is a retry-heavy path. The demo gives each statement line its TigerBeetle transfer IDs up front, stores them on the line, and reuses them during processing, so retries return `exists` instead of duplicating money movement. Used in `src/simulator/store.js`, `src/statement-processor.js`, and `src/tb-errors.js`.
- Batched requests matter because this kind of platform is naturally bursty: many inbound payments, sweeps, withdrawals, and statement lines. The demo batches statement posting, load-test transfers, accrual writes, and balance lookups rather than doing everything one request at a time. Used in `src/tb-batches.js`, `src/statement-processor.js`, `src/api.js`, and `src/interest.js`.
- Integer amounts and 128-bit IDs matter because money needs exact arithmetic and the ledger needs native TigerBeetle identifiers. The demo converts GBP to scale-8 integers before submission and uses TigerBeetle IDs for accounts and transfers throughout. Used in `src/config.js`, `src/transfers.js`, `src/customers.js`, `src/banks.js`, and `src/simulator/store.js`.

## Notes On `src/config.js`

`src/config.js` is effectively the shared ledger vocabulary for the demo, so a lot of the rest of the code makes more sense once you know what is defined there.

- `LEDGER_ID = 1` means everything in this demo is posted into a single TigerBeetle ledger. Transfers cannot happen between ledgers, a common use here is to split currencies.
- `ASSET_SCALE = 8` means amounts are stored as integer scale-8 values. So `1 GBP` is `100000000` internal units. That is why the code keeps converting between user-facing decimal amounts and integer amounts before posting.
- `AccountCode` is the chart of accounts. The exact numeric values are not important, but the grouping is:
  - `100x` for assets
  - `200x` for liabilities
  - `300x` for income
  That makes it easy to see what kind of account you are looking at when reading account creation or inspecting transfers.
- The asset account codes cover the platform cash states:
  - pooled client money
  - bank cash pending placement
  - bank cash settled at the partner bank
  - bank interest receivable
  - operating cash
- The liability account codes cover the customer money states:
  - unattributed receipts
  - customer holding
  - product principal
  - accrued interest payable
- `AccountFlags` is where the demo pulls in the TigerBeetle flags it actually uses. In practice, the important ones are:
  - `credits_must_not_exceed_debits` for asset accounts
  - `debits_must_not_exceed_credits` for liability and income accounts
  - `linked` for account creations that must succeed together
- `TransferFlags` currently only exposes `linked`, because the main transfer-level feature this demo uses is atomic multi-leg posting.
- `TransferCode` is the transaction taxonomy for the ledger. It is useful because every posted transfer has an explicit business meaning
- `AccountId` defines the fixed system accounts. These are the accounts that always exist regardless of how many customers or banks are created:
  - `CLIENT_MONEY`
  - `UNATTRIBUTED_RECEIPTS`
  - `OPERATING_CASH`
  - `FEE_INCOME`
  Having fixed IDs for these makes the rest of the posting logic much simpler, because those core accounts are referenced everywhere.
- `PHYSICAL_ACCOUNT_IBAN` is the single pooled real-world account used by the simulator. All external money movement comes through that account, while virtual IBANs are used to work out which customer a payment belongs to.

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
- inject inbound payments
- allocate holding cash into a product
- confirm placement with the partner bank
- run bank EOD accrual
- simulate bank interest payment through statement lines
- run load traffic from the dedicated load UI
- collect fees into operating cash

