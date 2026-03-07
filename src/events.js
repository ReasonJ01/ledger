/** Simple broadcast for balance-change notifications (SSE) */

const listeners = new Set();

export function subscribe(res) {
  listeners.add(res);
  res.on("close", () => listeners.delete(res));
}

export function broadcast() {
  for (const res of listeners) {
    try {
      res.write("data: refresh\n\n");
    } catch (_) {}
  }
}
