# Ledger V2 — Transaction Flow

This document describes the end-to-end financial flow for Ledger V2.

The design separates:

1. Customer obligation state (who the platform owes money to)
2. Cash location state (where money physically resides)
3. Instruction events (intent)
4. Confirmation events (settlement reality)

The ledger reflects real-world settlement timing rather than assuming immediate completion.

---

## 1. Deposit Received

External cash enters the safeguarded pooled account.

**Cash side**
- Dr cash:safeguard:pooled
- Cr obligation:unidentified_receipts

---

## 2. Receipt Identified to Customer

Deposit is matched to a specific customer.

**Customer side**
- Dr obligation:unidentified_receipts
- Cr obligation:customer:<cust_id>:available_cash

Customer now has usable platform cash.

---

## 3. Customer Subscribes to Product (Instruction)

Customer commits funds to an investment product.

**Customer side**
- Dr obligation:customer:<cust_id>:available_cash
- Cr obligation:customer:<cust_id>:product:<product_id>:subscription_in_progress

Funds are reserved but not yet invested.

---

## 4. Funds Sent to Partner Bank (Cash Movement)

Platform sends money externally to partner bank.

Triggered by bank statement debit.

**Cash side**
- Dr cash:partner_bank:<bank_id>:placement_in_transit
- Cr cash:safeguard:pooled

Funds are now in transit to the partner bank.

---

## 5. Placement Confirmed by Partner Bank (Confirmation)

Partner confirms funds are successfully invested.

**Customer side**
- Dr obligation:customer:<cust_id>:product:<product_id>:subscription_in_progress
- Cr obligation:customer:<cust_id>:product:<product_id>:principal_invested

**Cash side**
- Dr cash:partner_bank:<bank_id>:principal_placed
- Cr cash:partner_bank:<bank_id>:placement_in_transit

Customer is now fully invested.

---

## 6. Interest Accrual (Accounting Event)

Interest is earned but not yet paid.

**Cash side**
- Dr cash:partner_bank:<bank_id>:interest_due_from_bank

**Customer side**
- Cr obligation:customer:<cust_id>:product:<product_id>:interest_accrued

**Platform revenue**
- Cr revenue:fees:earned

Fees are recognized at accrual time.

---

## 7. Interest Capitalization

Accrued interest is added to invested principal.

**Customer side**
- Dr obligation:customer:<cust_id>:product:<product_id>:interest_accrued
- Cr obligation:customer:<cust_id>:product:<product_id>:principal_invested

---

## 8. Interest Cash Received (Cash Movement)

Partner bank pays interest.

Triggered by bank statement credit.

**Cash side**
- Dr cash:safeguard:pooled
- Cr cash:partner_bank:<bank_id>:interest_due_from_bank

---

## 9. Customer Requests Redemption (Instruction)

Customer exits the investment.

**Customer side**
- Dr obligation:customer:<cust_id>:product:<product_id>:principal_invested
- Cr obligation:customer:<cust_id>:product:<product_id>:redemption_in_progress

Investment is unwound but cash not yet returned.

---

## 10. Redemption Confirmed by Partner Bank (Confirmation)

Partner confirms redemption processing.

**Cash side**
- Dr cash:partner_bank:<bank_id>:redemption_in_transit
- Cr cash:partner_bank:<bank_id>:principal_placed

Funds are no longer invested and are being returned.

---

## 11. Redeemed Cash Returned (Cash Movement)

Funds return to safeguarded pooled account.

Triggered by bank statement credit.

**Cash side**
- Dr cash:safeguard:pooled
- Cr cash:partner_bank:<bank_id>:redemption_in_transit

**Customer side**
- Dr obligation:customer:<cust_id>:product:<product_id>:redemption_in_progress
- Cr obligation:customer:<cust_id>:available_cash

Customer now has usable platform cash again.

---

## 12. Customer Requests Withdrawal (Instruction)

Customer requests payout to their nominated bank.

**Customer side**
- Dr obligation:customer:<cust_id>:available_cash
- Cr obligation:customer:<cust_id>:withdrawal_in_progress

Funds are reserved for payout.

---

## 13. Withdrawal Paid (Cash Movement)

Outbound payment confirmed by bank statement.

**Customer side**
- Dr obligation:customer:<cust_id>:withdrawal_in_progress

**Cash side**
- Cr cash:safeguard:pooled

Withdrawal is complete.

---

## 14. Fee Sweep to Operating Cash

Platform transfers earned fees out of safeguarded funds.

**Cash side**
- Dr cash:platform:operating
- Cr cash:safeguard:pooled

---

# State Lifecycle Summary

## Customer Funds

available_cash  
→ subscription_in_progress  
→ principal_invested  
→ redemption_in_progress  
→ available_cash  
→ withdrawal_in_progress  
→ withdrawn

---

## Cash Location

safeguard:pooled  
→ placement_in_transit  
→ principal_placed  
→ redemption_in_transit  
→ safeguard:pooled  
→ external payout

---

# Design Principles

1. External movements are two-stage: instruction then confirmation
2. Customer state changes do not imply cash location changes
3. Cash location changes do not imply customer state completion
4. Ledger reflects operational and economic truth
5. No state is finalized without external confirmation
