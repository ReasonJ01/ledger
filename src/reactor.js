import { createClient } from "tigerbeetle-node";
import { ensureAccounts } from "./accounts.js";
import { processPendingStatementLines } from "./statement-processor.js";
import { broadcast } from "./events.js";

const POLL_INTERVAL_MS = 5000;
const TB_ADDRESS = process.env.TB_ADDRESS || "3000";
const TB_CLUSTER_ID = BigInt(process.env.TB_CLUSTER_ID || "1");

export async function createTigerBeetleClient() {
  return createClient({
    cluster_id: TB_CLUSTER_ID,
    replica_addresses: [TB_ADDRESS],
  });
}

export async function runReactor() {
  const client = await createTigerBeetleClient();
  await ensureAccounts(client);

  console.log(`Reactor running. Polling every ${POLL_INTERVAL_MS / 1000}s. Press Ctrl+C to stop.`);

  const poll = async () => {
    try {
      const stats = await processPendingStatementLines(client, { log: true });
      if (stats.total > 0) broadcast();
    } catch (err) {
      console.error("Reactor error:", err.message);
    }
    setTimeout(poll, POLL_INTERVAL_MS);
  };

  poll();
}
