# Ledger V2 — Design Draft

## Objectives

Ledger V2 refines the platform ledger to:

1. Separate economic ownership from operational settlement state
2. Make account purposes obvious to engineers, auditors, and operators
3. Remove ambiguous terms such as “holding” and “pool”
4. Reflect real-world settlement latency
5. Align account naming with consistent structural patterns

---

## Naming Convention

Accounts follow a structured format:

<class>:<scope>:<entity>:<sub-entity>:<state>

Examples:

- cash:safeguard:pooled
- cash:partner_bank:BANK_A:principal_placed
- obligation:customer:cust_42:available_cash

### Account Classes

| Class | Meaning |
|------|---------|
| cash | Platform-controlled assets |
| obligation | Customer liabilities |
| revenue | Platform income |

---

# Assets — Platform-Controlled Cash

These accounts track where money physically or legally resides.

### cash:safeguard:pooled

Purpose: Client funds held in safeguarded pooled bank accounts.

Economic Meaning: Funds belong to customers but are custodied by the platform.

Increases:
- Customer deposits received
- Interest payments received
- Investment redemptions returned

Decreases:
- Funds placed with partner banks
- Customer withdrawals paid
- Platform fees transferred to operating cash

---

### cash:partner_bank:<bank_id>:placement_in_transit

Purpose: Funds instructed for placement but not yet confirmed by the partner bank.

Economic Meaning: Cash is operationally committed but not yet earning yield.

Increases:
- Placement instruction sent

Decreases:
- Placement confirmed
- Placement fails and funds return

---

### cash:partner_bank:<bank_id>:principal_placed

Purpose: Funds confirmed as actively invested with the partner bank.

Economic Meaning: Principal currently earning yield.

Increases:
- Placement confirmation

Decreases:
- Investment redemption
- Principal adjustments or losses

---

### cash:partner_bank:<bank_id>:interest_due_from_bank

Purpose: Interest earned but not yet paid by the partner bank.

Economic Meaning: Accrued yield contractually owed to the platform.

Increases:
- Interest accrual events

Decreases:
- Interest payment received
- Accrual reversals

---

### cash:platform:operating

Purpose: Platform-owned funds available for operating expenses.

Economic Meaning: Money legally owned by the platform.

Increases:
- Fees swept from safeguarded cash

Decreases:
- Operating expenses paid

---

# Liabilities — Customer Obligations

These accounts represent amounts owed to customers.

### obligation:unidentified_receipts

Purpose: Funds received but not yet matched to a customer.

Economic Meaning: Money belongs to an unidentified customer.

Increases:
- Unmatched deposits received

Decreases:
- Receipt matched to customer
- Funds returned

---

### obligation:customer:<cust_id>:available_cash

Purpose: Customer funds available for withdrawal or investment.

Economic Meaning: Immediately usable wallet balance.

Increases:
- Deposits identified
- Investment redemptions
- Interest credited as cash

Decreases:
- Product subscriptions
- Withdrawal requests

---

### obligation:customer:<cust_id>:withdrawal_in_progress

Purpose: Funds committed to a withdrawal process awaiting completion.

Economic Meaning: Still owed to the customer but operationally reserved.

Increases:
- Withdrawal initiated

Decreases:
- Withdrawal completed
- Withdrawal failed and funds restored

---

### obligation:customer:<cust_id>:product:<product_id>:subscription_in_progress

Purpose: Funds committed to investment but not yet successfully placed.

Economic Meaning: Customer surrendered liquidity but investment not active.

Increases:
- Subscription request submitted

Decreases:
- Placement confirmed
- Subscription cancelled or failed

---

### obligation:customer:<cust_id>:product:<product_id>:principal_invested

Purpose: Customer principal successfully invested.

Economic Meaning: Active investment balance earning yield.

Increases:
- Placement confirmation
- Interest capitalization

Decreases:
- Redemption requests

---

### obligation:customer:<cust_id>:product:<product_id>:interest_accrued

Purpose: Interest earned but not yet paid out or capitalized.

Economic Meaning: Yield owed to the customer.

Increases:
- Interest accrual

Decreases:
- Interest capitalization
- Interest payout

---

# Revenue

### revenue:fees:earned

Purpose: Platform revenue earned from product fees.

Economic Meaning: Income recognized under platform accounting policy.

Increases:
- Fee accrual from interest spreads

Decreases:
- Revenue adjustments or reversals

---

# Key Improvements Over V1

| V1 Term | V2 Term | Improvement |
|--------|---------|------------|
| Holding | Available cash | Clarifies liquidity |
| Client money pool | Safeguarded pooled cash | Clarifies legal status |
| Cash pending placement | Placement in transit | Clarifies settlement timing |
| Cash at bank | Principal placed | Clarifies investment state |
| Interest receivable | Interest due from bank | Plain language |
| Interest payable | Interest accrued | Avoids payout implication |

---

# Design Principles

1. One account = one economic meaning
2. Customer-visible states must exist explicitly
3. Settlement latency must be visible
4. Legal ownership must not be ambiguous
5. Names should be understandable without accounting jargon
