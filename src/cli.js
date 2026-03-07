import {
  apiAccrueInterestBank,
  apiBalances,
  apiCollectFees,
  apiCreateBank,
  apiCreateCustomer,
  apiCreateProduct,
  apiDeposit,
  apiInject,
  apiOpenProduct,
  apiSimulateBankInterestPayment,
  apiSettle,
} from "./api.js";

export async function cmdCreateCustomer() {
  const customer = await apiCreateCustomer();
  console.log("Created:", customer.customer_id, "| Virtual IBAN:", customer.virtual_iban);
}

export async function cmdInject(args) {
  const amount = args[1] ?? "10.00";
  const customerOrIban = args[2];
  const line = await apiInject(amount, customerOrIban);
  console.log("Injected:", line.amount, line.currency, "->", line.creditor_account_iban);
}

export async function cmdCreateProduct(args) {
  const productId = args[1] ?? "PRODUCT_A";
  const bankId = args[2];
  const name = args[3];
  const grossRate = parseFloat(args[4]) || 0;
  const feeShare = parseFloat(args[5]) || 0;
  if (!bankId) throw new Error("Usage: create-product <product_id> <bank_id> [name] [gross_rate] [fee_share]");
  const product = await apiCreateProduct(productId, bankId, name, grossRate, feeShare);
  const gross = product.gross_rate ? ` gross ${(product.gross_rate * 100).toFixed(2)}%` : "";
  const fee = product.fee_share ? ` fee share ${(product.fee_share * 100).toFixed(2)}%` : "";
  console.log("Created product:", product.product_id, "at bank", product.bank_id, `${gross}${fee}`.trim());
}

export async function cmdOpenProduct(args) {
  const customerId = args[1];
  const productId = args[2];
  if (!customerId || !productId) throw new Error("Usage: open-product <customer_id> <product_id>");
  await apiOpenProduct(customerId, productId);
  console.log("Opened", productId, "for", customerId);
}

export async function cmdDeposit(args) {
  const customerId = args[1];
  const productId = args[2];
  const amount = args[3] ?? "10.00";
  if (!customerId || !productId) throw new Error("Usage: deposit <customer_id> <product_id> [amount]");
  const result = await apiDeposit(customerId, productId, amount);
  console.log("Allocated", amount, "from", customerId, "holding ->", `${productId} (${result.bank_id} pending placement)`);
}

export async function cmdCreateBank(args) {
  const bankId = args[1] ?? "BANK_A";
  const bank = await apiCreateBank(bankId);
  console.log("Created bank:", bank.bank_id);
}

export async function cmdAccrueInterest(args) {
  const bankId = args[1];
  if (!bankId) throw new Error("Usage: accrue-interest <bank_id>");
  const result = await apiAccrueInterestBank(bankId);
  if (parseFloat(result.gross_accrued) > 0) {
    console.log(
      `Accrued ${bankId} gross`,
      result.gross_accrued,
      "| customer",
      result.customer_accrued,
      "| fees",
      result.fee_accrued,
      "| realised",
      result.realised
    );
  } else {
    console.log("No balances large enough to accrue");
  }
}

export async function cmdRealiseInterest(args) {
  const bankId = args[1];
  const amount = args[2];
  if (!bankId) throw new Error("Usage: realise-interest <bank_id> [amount]");
  const result = await apiSimulateBankInterestPayment(bankId, amount);
  if (result.simulated) {
    console.log(`Simulated bank-interest statement line for ${bankId}:`, result.amount, `(${result.statement_id})`);
  } else {
    console.log(result.message || "No receivable interest to pay");
  }
}

export async function cmdCollectFees(args) {
  const amount = args[1];
  const result = await apiCollectFees(amount);
  if (result.collected) console.log("Collected fees:", result.amount);
  else console.log(result.message || "No collectable fees");
}

export async function cmdSettle(args) {
  const bankId = args[1];
  if (!bankId) throw new Error("Usage: settle <bank_id>");
  const result = await apiSettle(bankId);
  if (result.settled) console.log("Simulated physical sweep to", bankId, ":", result.amount, "(reactor posts settlement)");
  else console.log(result.message || "No pending placements");
}

export async function cmdBalances() {
  const { balances } = await apiBalances();
  for (const balance of balances) {
    console.log(`${balance.label}: ${balance.balance}`);
  }
}
