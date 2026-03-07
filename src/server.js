import express from "express";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { subscribe, broadcast } from "./events.js";
import {
  apiCreateCustomer,
  apiCreateProduct,
  apiCreateBank,
  apiOpenProduct,
  apiInject,
  apiDeposit,
  apiWithdrawToHolding,
  apiWithdrawToNominated,
  apiSettle,
  apiProcessStatementLines,
  apiLoadBootstrap,
  apiLoadRun,
  apiCollectableFees,
  apiCollectFees,
  apiSettleableAll,
  apiAccrueInterest,
  apiAccrueInterestBank,
  apiBankInterestReceivableAll,
  apiSimulateBankInterestPayment,
  apiReconciliation,
  apiBalances,
  apiListCustomers,
  apiListProducts,
  apiListBanks,
} from "./api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(join(__dirname, "public")));
app.get("/", (_, res) => res.sendFile(join(__dirname, "public", "index.html")));

app.get("/api/customers", (_, res) => res.json(apiListCustomers()));
app.get("/api/products", (_, res) => res.json(apiListProducts()));
app.get("/api/banks", (_, res) => res.json(apiListBanks()));
app.get("/api/balances", async (_, res) => {
  try {
    res.json(await apiBalances());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/settleable", async (_, res) => {
  try {
    res.json(await apiSettleableAll());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/collectable-fees", async (_, res) => {
  try {
    res.json(await apiCollectableFees());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/bank-interest-receivable", async (_, res) => {
  try {
    res.json(await apiBankInterestReceivableAll());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/reconciliation", async (_, res) => {
  try {
    res.json(await apiReconciliation());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  subscribe(res);
});

app.post("/api/create-customer", async (_, res) => {
  try {
    const r = await apiCreateCustomer();
    broadcast();
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/create-product", async (req, res) => {
  try {
    const { product_id, bank_id, name, gross_rate, fee_share } = req.body ?? {};
    const r = await apiCreateProduct(product_id, bank_id, name, gross_rate, fee_share);
    broadcast();
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/create-bank", async (req, res) => {
  try {
    const { bank_id } = req.body ?? {};
    const r = await apiCreateBank(bank_id);
    broadcast();
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/open-product", async (req, res) => {
  try {
    const { customer_id, product_id } = req.body ?? {};
    if (!customer_id || !product_id) throw new Error("customer_id and product_id required");
    const r = await apiOpenProduct(customer_id, product_id);
    broadcast();
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/inject", async (req, res) => {
  try {
    const { amount, customer_id } = req.body ?? {};
    const r = await apiInject(amount, customer_id);
    broadcast();
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/deposit", async (req, res) => {
  try {
    const { customer_id, product_id, amount } = req.body ?? {};
    if (!customer_id || !product_id) throw new Error("customer_id and product_id required");
    const r = await apiDeposit(customer_id, product_id, amount);
    broadcast();
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/accrue-interest", async (req, res) => {
  try {
    const { product_id } = req.body ?? {};
    if (!product_id) throw new Error("product_id required");
    const r = await apiAccrueInterest(product_id);
    broadcast();
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/withdraw-to-holding", async (req, res) => {
  try {
    const { customer_id, product_id, amount } = req.body ?? {};
    if (!customer_id || !product_id) throw new Error("customer_id and product_id required");
    const r = await apiWithdrawToHolding(customer_id, product_id, amount);
    broadcast();
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/withdraw-to-nominated", async (req, res) => {
  try {
    const { customer_id, amount } = req.body ?? {};
    if (!customer_id) throw new Error("customer_id required");
    const r = await apiWithdrawToNominated(customer_id, amount);
    broadcast();
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/accrue-interest-bank", async (req, res) => {
  try {
    const { bank_id } = req.body ?? {};
    if (!bank_id) throw new Error("bank_id required");
    const r = await apiAccrueInterestBank(bank_id);
    broadcast();
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/realise-interest", async (req, res) => {
  try {
    const { bank_id, amount } = req.body ?? {};
    if (!bank_id) throw new Error("bank_id required");
    const r = await apiSimulateBankInterestPayment(bank_id, amount);
    broadcast();
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/collect-fees", async (req, res) => {
  try {
    const { amount } = req.body ?? {};
    const r = await apiCollectFees(amount);
    broadcast();
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/settle", async (req, res) => {
  try {
    const { bank_id } = req.body ?? {};
    if (!bank_id) throw new Error("bank_id required");
    const r = await apiSettle(bank_id);
    broadcast();
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/process-statement-lines", async (_, res) => {
  try {
    const r = await apiProcessStatementLines();
    if (r.total > 0) broadcast();
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/load-bootstrap", async (req, res) => {
  try {
    const r = await apiLoadBootstrap(req.body ?? {});
    broadcast();
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/load-run", async (req, res) => {
  try {
    const r = await apiLoadRun(req.body ?? {});
    broadcast();
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export function startServer() {
  return app.listen(PORT, () => {
    console.log(`Web UI: http://localhost:${PORT}`);
  });
}
