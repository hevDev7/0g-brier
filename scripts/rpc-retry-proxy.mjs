#!/usr/bin/env node
/**
 * A local JSON-RPC proxy that retries NULL answers.
 *
 *   node scripts/rpc-retry-proxy.mjs [--port 8545] [--upstream https://evmrpc.0g.ai]
 *
 * WHY THIS EXISTS. 0G's mainnet RPC answers `eth_getTransactionReceipt` with null
 * for transactions that are demonstrably mined — three separate deploys died on it,
 * at transactions 8, 19 and 21 of 91, and every one of those transactions was found
 * on chain afterwards with status 1. It looks like a load balancer in front of nodes
 * that have not all caught up: ask again and a synced node answers.
 *
 * Foundry cannot tell "not mined yet" from "this node has not seen it", because both
 * are null, and it gives up. So the retry has to happen below Foundry. This proxy
 * forwards everything untouched except that a null `result` for the receipt and
 * transaction lookups is retried before being passed on.
 *
 * It changes no semantics: a transaction that genuinely is not mined still comes back
 * null after the retries, which is what a caller polling for it expects.
 */
import http from "node:http";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg("--port", "8545"));
const UPSTREAM = arg("--upstream", "https://evmrpc.0g.ai");
// Methods whose null answer is worth doubting. Both are "look up a thing by hash",
// where null means either "not yet" or "not on this node" and the caller cannot tell.
const RETRY_ON_NULL = new Set(["eth_getTransactionReceipt", "eth_getTransactionByHash"]);
const TRIES = Number(arg("--tries", "8"));
const BACKOFF_MS = Number(arg("--backoff", "400"));

let retried = 0;
let rescued = 0;
const nullsByMethod = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function forward(body) {
  const res = await fetch(UPSTREAM, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body,
  });
  const text = await res.text();
  return {status: res.status, text};
}

/** null-ness of a single JSON-RPC response object. */
const isNullResult = (o) => o && typeof o === "object" && !("error" in o) && o.result === null;

async function handle(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return forward(body); // not our business
  }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  const wantsRetry = calls.some((c) => RETRY_ON_NULL.has(c?.method));

  let out = await forward(body);

  // Log EVERY null answer with its method. The first version of this proxy retried
  // only the two lookups it assumed were at fault, and the deploy still died — so
  // what is actually returning null has to be observed, not guessed.
  try {
    const first = JSON.parse(out.text);
    for (const [i, o] of (Array.isArray(first) ? first : [first]).entries()) {
      if (isNullResult(o)) {
        const m = calls[i]?.method ?? "?";
        nullsByMethod.set(m, (nullsByMethod.get(m) ?? 0) + 1);
        if (!RETRY_ON_NULL.has(m)) console.error(`rpc-retry-proxy: NULL from ${m} (not retried)`);
      }
      if (o && o.error) console.error(`rpc-retry-proxy: ERROR from ${calls[i]?.method}: ${JSON.stringify(o.error).slice(0, 160)}`);
    }
  } catch {
    /* not JSON; nothing to learn */
  }

  if (!wantsRetry) return out;

  for (let i = 1; i < TRIES; i++) {
    let answer;
    try {
      answer = JSON.parse(out.text);
    } catch {
      return out;
    }
    const list = Array.isArray(answer) ? answer : [answer];
    // Only the entries whose method we doubt count towards "still null".
    const stillNull = list.some((o, idx) => RETRY_ON_NULL.has(calls[idx]?.method) && isNullResult(o));
    if (!stillNull) {
      if (i > 1) rescued++;
      return out;
    }
    retried++;
    await sleep(BACKOFF_MS * i);
    out = await forward(body);
  }
  return out;
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try {
      const {status, text} = await handle(body);
      res.writeHead(status, {"content-type": "application/json"}).end(text);
    } catch (e) {
      res.writeHead(502, {"content-type": "application/json"}).end(
        JSON.stringify({jsonrpc: "2.0", id: null, error: {code: -32000, message: String(e)}}),
      );
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.error(`rpc-retry-proxy: 127.0.0.1:${PORT} -> ${UPSTREAM}  (${TRIES} tries on a null receipt)`);
});

const report = () => {
  console.error(`rpc-retry-proxy: ${retried} retries, ${rescued} nulls that turned into an answer`);
  for (const [m, n] of [...nullsByMethod].sort((a, b) => b[1] - a[1])) console.error(`  null x${n}  ${m}`);
};
process.on("SIGINT", () => {
  report();
  process.exit(0);
});
process.on("SIGTERM", () => {
  report();
  process.exit(0);
});
