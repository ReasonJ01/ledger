import { createInterface } from "readline";

async function main() {
  console.log("[startup] Loading application modules...");
  const api = await import("./api.js");
  console.log("[startup] API module loaded");
  const { runReactor } = await import("./reactor.js");
  console.log("[startup] Reactor module loaded");
  const { startServer } = await import("./server.js");
  console.log("[startup] Server module loaded");
  console.log("[startup] Connecting to TigerBeetle...");
  await api.init();
  console.log("[startup] TigerBeetle ready");

  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "cli") {
    const {
      cmdCreateCustomer,
      cmdCreateProduct,
      cmdCreateBank,
      cmdOpenProduct,
      cmdInject,
      cmdDeposit,
      cmdAccrueInterest,
      cmdRealiseInterest,
      cmdCollectFees,
      cmdSettle,
      cmdBalances,
    } = await import("./cli.js");
    runReactor();
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const prompt = () => rl.question("> ", async (line) => {
      const parts = line.trim().split(/\s+/);
      const cmd = parts[0]?.toLowerCase();
      if (!cmd || cmd === "exit" || cmd === "quit") {
        rl.close();
        process.exit(0);
      }
      try {
        if (cmd === "create-customer") await cmdCreateCustomer();
        else if (cmd === "create-product") await cmdCreateProduct(parts);
        else if (cmd === "create-bank") await cmdCreateBank(parts);
        else if (cmd === "open-product") await cmdOpenProduct(parts);
        else if (cmd === "inject") await cmdInject(parts);
        else if (cmd === "deposit") await cmdDeposit(parts);
        else if (cmd === "accrue-interest") await cmdAccrueInterest(parts);
        else if (cmd === "realise-interest") await cmdRealiseInterest(parts);
        else if (cmd === "collect-fees") await cmdCollectFees(parts);
        else if (cmd === "settle") await cmdSettle(parts);
        else if (cmd === "balances") await cmdBalances();
        else console.log("Commands: create-customer, create-product, create-bank, open-product, inject, deposit, accrue-interest, realise-interest, collect-fees, settle, balances, exit");
      } catch (err) {
        console.error(err.message);
      }
      prompt();
    });
    console.log("Reactor running. Commands: create-customer, create-product, create-bank, open-product, inject, deposit, accrue-interest, realise-interest, collect-fees, settle, balances, exit\n");
    prompt();
    return;
  }

  if (command === "balances") {
    const { cmdBalances } = await import("./cli.js");
    await cmdBalances();
    return;
  }

  runReactor();
  startServer();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
