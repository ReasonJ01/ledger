import { getBankById } from "./banks.js";

const products = new Map();

export function createProduct(productId, bankId, name, grossRate = 0, feeShare = 0) {
  if (products.has(productId)) throw new Error(`Product ${productId} already exists`);
  const bank = getBankById(bankId);
  if (!bank) throw new Error(`Bank ${bankId} not found`);
  if (Number(feeShare) < 0 || Number(feeShare) > 1) {
    throw new Error("fee_share must be between 0 and 1");
  }
  const product = {
    product_id: productId,
    bank_id: bankId,
    name: name ?? productId,
    gross_rate: Number(grossRate) || 0,
    fee_share: Number(feeShare) || 0,
  };
  products.set(productId, product);
  return product;
}

export function getProductById(productId) {
  return products.get(productId) ?? null;
}

export function getAllProducts() {
  return Array.from(products.values());
}
