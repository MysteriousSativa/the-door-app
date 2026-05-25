"use strict";
/* ============================================================================
 * server.js — zero-dependency, server-authoritative app skeleton for THE DOOR.
 *
 * Run:  node src/server.js   (or: npm start)   then open http://127.0.0.1:8765
 *
 * Realtime uses Server-Sent Events (SSE): server -> client push for the shared
 * reality (live counter, leaderboard, whispers, global events). Client -> server
 * actions (feed, connect) are plain POST. This is dependency-free and upgrades
 * cleanly to WebSockets / a managed bus later without changing the client model.
 *
 * The server owns ALL truth: counters, leaderboard, sessions, events, the feed
 * ledger. The client only renders what the server says.
 * ==========================================================================*/

try { require("dotenv").config(); } catch (_) {}
const http   = require("http");
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const store  = require("./store");
const engine = require("./engine");

const TOKEN_MINT     = process.env.TOKEN_MINT || null;
const TOKEN_DECIMALS = Number(process.env.TOKEN_DECIMALS || 6);
const SOLANA_RPC     = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";

// Solana only loaded when TOKEN_MINT is configured
let solanaConnection = null, MINT_PUBKEY = null;
if (TOKEN_MINT) {
  try {
    const { Connection, PublicKey } = require("@solana/web3.js");
    solanaConnection = new Connection(SOLANA_RPC, "confirmed");
    MINT_PUBKEY      = new PublicKey(TOKEN_MINT);
  } catch (e) {
    console.warn("Solana not available:", e.message);
  }
}

const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.HOST || "0.0.0.0"; // 0.0.0.0 so it works inside Docker
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const MAX_SSE = Number(process.env.MAX_SSE || 2000); // hard cap on concurrent streams

/* ---------------- world state (authoritative, shared) ---------------- */
const world = { activeEvent: null, eventEndsAt: 0, cycle: 1 };

/* ---------------- SSE clients ---------------- */
const clients = new Set();
function broadcast(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(payload); } catch (_) { clients.delete(res); } }
}


/* ---------------- helpers ---------------- */
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = ""; req.on("data", c => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}
async function leaderboardSnapshot() {
  const top = await store.leaderboard.top(12);
  return top.map(r => ({ id: r.id, name: r.name || "stranger", score: r.score,
    rank: engine.rankFor(r.score).name, position: r.position, sim: !!r.sim }));
}
const HANDLES = ["stranger","newmouth","late_knock","unmarked","passerby","the_curious"];

/* ---------------- REST + SSE routing ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  // ---- health check (for Docker / load balancers) ----
  if (p === "/healthz") {
    return sendJSON(res, 200, { ok: true, clients: clients.size, uptime: process.uptime(),
      activeEvent: world.activeEvent ? world.activeEvent.name : null });
  }

  // ---- SSE stream (shared reality) ----
  if (p === "/api/stream") {
    if (clients.size >= MAX_SSE) { res.writeHead(503); return res.end("at capacity"); }
    res.writeHead(200, {
      "Content-Type": "text/event-stream", "Cache-Control": "no-cache",
      "Connection": "keep-alive", "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n");
    clients.add(res);
    // initial snapshot so a fresh client is immediately in sync
    leaderboardSnapshot().then(async lb => {
      res.write(`event: snapshot\ndata: ${JSON.stringify({
        devoured: await store.counters.get("devoured"),
        leaderboard: lb, world,
      })}\n\n`);
    });
    req.on("close", () => clients.delete(res));
    return;
  }

  // ---- API ----
  if (p === "/api/session" && req.method === "POST") {
    const id = crypto.randomBytes(8).toString("hex");
    const session = engine.newSession(id);
    session.name = HANDLES[Math.floor(Math.random()*HANDLES.length)] + "_" + id.slice(0,3);
    await store.sessions.set(id, session);
    await store.leaderboard.set(`u:${id}`, 0, { name: session.name });
    return sendJSON(res, 200, {
      sessionId: id, session: engine.publicSession(session),
      devoured: await store.counters.get("devoured"),
      leaderboard: await leaderboardSnapshot(), world,
      config: { freeFeeds: engine.FREE_FEEDS, feedCost: engine.FEED_COST },
    });
  }

  if (p === "/api/connect" && req.method === "POST") {
    const { sessionId, walletPubkey } = await readBody(req);
    const session = await store.sessions.get(sessionId);
    if (!session) return sendJSON(res, 404, { error: "no session" });

    // Validate pubkey format (basic length check if Solana not loaded)
    if (!walletPubkey || typeof walletPubkey !== "string" || walletPubkey.length < 32) {
      return sendJSON(res, 400, { error: "invalid pubkey" });
    }
    if (MINT_PUBKEY) {
      try { const { PublicKey } = require("@solana/web3.js"); new PublicKey(walletPubkey); }
      catch { return sendJSON(res, 400, { error: "invalid pubkey" }); }
    }

    // Fetch actual BTDOOR balance from chain (only when token is configured)
    let balance = 500; // default simulated balance when token not yet live
    if (solanaConnection && MINT_PUBKEY) {
      try {
        const { PublicKey } = require("@solana/web3.js");
        const pubkey = new PublicKey(walletPubkey);
        const accounts = await solanaConnection.getParsedTokenAccountsByOwner(pubkey, { mint: MINT_PUBKEY });
        balance = 0;
        for (const { account } of accounts.value) {
          balance += Number(account.data.parsed.info.tokenAmount.uiAmount || 0);
        }
      } catch (e) {
        console.error("RPC balance fetch failed:", e.message);
      }
    }

    session.connected   = true;
    session.walletPubkey = walletPubkey;
    session.balance      = Math.floor(balance);   // whole tokens, no decimals
    await store.sessions.set(sessionId, session);
    broadcast("whisper", { actor: "Threshold", text: `${session.name} opened a new mouth.` });
    return sendJSON(res, 200, { session: engine.publicSession(session), onChainBalance: balance });
  }

  if (p === "/api/feed" && req.method === "POST") {
    const { sessionId, nonce, txSig } = await readBody(req);
    const session = await store.sessions.get(sessionId);
    if (!session) return sendJSON(res, 404, { error: "no session" });
    if (!nonce || typeof nonce !== "string") return sendJSON(res, 400, { error: "nonce required" });

    // idempotency: a retried request with the same nonce returns the original
    // authoritative result, so a dropped HTTP response does not strand a client.
    const prior = await store.ledger.result(nonce);
    if (prior) return sendJSON(res, prior.code, { duplicate: true, ...prior.body });

    // On-chain burn verification — only active once TOKEN_MINT is configured
    if (solanaConnection && TOKEN_MINT && session.connected && session.walletPubkey && session.freeFeeds <= 0) {
      if (!txSig) return sendJSON(res, 400, { error: "txSig required after free feeds are spent" });
      try {
        const tx = await solanaConnection.getParsedTransaction(txSig, {
          commitment: "confirmed", maxSupportedTransactionVersion: 0,
        });
        if (!tx) return sendJSON(res, 400, { error: "transaction not found — wait a moment and retry" });
        const allIx = [
          ...(tx.transaction.message.instructions || []),
          ...((tx.meta?.innerInstructions || []).flatMap(i => i.instructions)),
        ];
        const burnIx = allIx.find(ix =>
          ix.parsed?.type === "burn" &&
          ix.parsed?.info?.mint === TOKEN_MINT &&
          ix.parsed?.info?.authority === session.walletPubkey
        );
        if (!burnIx) return sendJSON(res, 400, { error: "valid BTDOOR burn not found in transaction" });
        const burnedUi = Number(burnIx.parsed.info.amount) / Math.pow(10, TOKEN_DECIMALS);
        if (burnedUi < engine.FEED_COST)
          return sendJSON(res, 400, { error: `burn too small: got ${burnedUi}, need ${engine.FEED_COST}` });
        const sigKey = "sig:" + txSig;
        if (await store.ledger.result(sigKey)) return sendJSON(res, 400, { error: "transaction already used" });
        await store.ledger.recordResult(sigKey, 200, { used: true });
      } catch (e) {
        console.error("burn verify error:", e.message);
        return sendJSON(res, 500, { error: "could not verify transaction" });
      }
    }

    const now = Date.now();
    const out = engine.resolveFeed(session, world, now);
    if (out.error) {
      await store.ledger.recordResult(nonce, 429, out);
      return sendJSON(res, 429, out);
    }

    // commit to the authoritative stores
    await store.sessions.set(sessionId, session);
    await store.counters.incr("devoured", out.devouredDelta);
    await store.leaderboard.set(`u:${session.id}`, session.offerings, { name: session.name });
    await store.ledger.record({ id: sessionId, nonce, gain: out.gain, at: now });

    // shared-reality side effects
    if (out.rankedUp) broadcast("whisper", { actor: "Marked", text: `${session.name} became ${out.rankedUp}.` });
    if (out.personal && out.personal.kind === "golden")
      broadcast("whisper", { actor: "Witnessed", text: `${session.name} found the Golden Door.` });
    if (out.collectable)
      broadcast("collectable", { player: session.name, collectable: out.collectable });

    const body = {
      ...out, devoured: await store.counters.get("devoured"),
      position: await store.leaderboard.rankOf(`u:${session.id}`),
    };
    await store.ledger.recordResult(nonce, 200, body);
    return sendJSON(res, 200, body);
  }

  if (p === "/api/trade" && req.method === "POST") {
    const { sessionId, iid } = await readBody(req);
    const session = await store.sessions.get(sessionId);
    if (!session) return sendJSON(res, 404, { error: "no session" });
    if (!session.inventory) session.inventory = [];
    const idx = session.inventory.findIndex(i => i.iid === iid);
    if (idx < 0) return sendJSON(res, 404, { error: "item not found" });
    const item = session.inventory.splice(idx, 1)[0];
    session.balance += item.value;
    await store.sessions.set(sessionId, session);
    return sendJSON(res, 200, { session: engine.publicSession(session), item, gained: item.value });
  }

  if (p === "/api/state" && req.method === "GET") {
    const session = await store.sessions.get(url.searchParams.get("sessionId"));
    if (!session) return sendJSON(res, 404, { error: "no session" });
    return sendJSON(res, 200, {
      session: engine.publicSession(session), world,
      devoured: await store.counters.get("devoured"),
      leaderboard: await leaderboardSnapshot(),
    });
  }

  if (p === "/api/config" && req.method === "GET") {
    return sendJSON(res, 200, {
      mint: TOKEN_MINT,
      decimals: TOKEN_DECIMALS,
      rpc: SOLANA_RPC,
      pumpUrl: `https://pump.fun/coin/${TOKEN_MINT}`,
    });
  }

  if (p === "/api/balance" && req.method === "GET") {
    const walletPubkey = url.searchParams.get("wallet");
    if (!walletPubkey) return sendJSON(res, 400, { error: "wallet required" });
    if (!solanaConnection || !MINT_PUBKEY) return sendJSON(res, 200, { balance: 0, note: "token not configured" });
    try {
      const { PublicKey } = require("@solana/web3.js");
      const pubkey   = new PublicKey(walletPubkey);
      const accounts = await solanaConnection.getParsedTokenAccountsByOwner(pubkey, { mint: MINT_PUBKEY });
      let balance = 0;
      for (const { account } of accounts.value) {
        balance += Number(account.data.parsed.info.tokenAmount.uiAmount || 0);
      }
      return sendJSON(res, 200, { balance: Math.floor(balance) });
    } catch (e) {
      return sendJSON(res, 400, { error: "invalid wallet or RPC error" });
    }
  }

  // ---- artifacts — serve from public/ ----
  if (p.startsWith("/artifacts/")) {
    const filename = path.basename(p);
    const artifactPath = path.join(PUBLIC_DIR, filename);
    fs.readFile(artifactPath, (err, data) => {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(data);
    });
    return;
  }

  // ---- static files (the client) ----
  let rel = decodeURIComponent(p === "/" ? "/index.html" : p);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    const ext = path.extname(file);
    const types = { ".html":"text/html; charset=utf-8", ".css":"text/css", ".js":"text/javascript", ".png":"image/png" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
});

/* ---------------- authoritative loops ---------------- */

// global event scheduler — the ONLY place global events are decided
setInterval(() => {
  if (world.activeEvent) return;
  if (Math.random() < 0.07) { // rare on purpose — a global event should feel like an event
    const ev = engine.GLOBAL_EVENTS[Math.floor(Math.random() * engine.GLOBAL_EVENTS.length)];
    world.activeEvent = ev; world.eventEndsAt = Date.now() + ev.durationMs;
    broadcast("global", { event: ev, endsAt: world.eventEndsAt });
    broadcast("whisper", { actor: ev.name, text: ev.text });
    setTimeout(() => {
      world.activeEvent = null;
      broadcast("global-end", { cycle: world.cycle });
      broadcast("whisper", { actor: "Threshold", text: "The event ended. The hunger did not." });
    }, ev.durationMs);
  }
}, 9000);

// simulated world feeders + live counter/leaderboard push (clearly simulated)
// Quiet ambient growth. A new, unknown project must NOT have a counter rocketing
// on its own — that screams fake. So at most ONE early believer stirs, only
// sometimes, and the counter barely moves unless real people are feeding (the
// big jumps come from actual feeds, which add FEED_COST each). Events add a
// little urgency. The room should feel sparse and real, not like a slot floor.
setInterval(async () => {
  const live = !!world.activeEvent;
  const mult = live ? world.activeEvent.multiplier : 1;
  if (Math.random() < (live ? 0.5 : 0.18)) {
    const bots = (await store.leaderboard.top(40)).filter(r => r.sim);
    if (bots.length) {
      await store.leaderboard.add(bots[Math.floor(Math.random() * bots.length)].id, 1 * mult);
      broadcast("leaderboard", await leaderboardSnapshot());
    }
  }
  broadcast("tick", { devoured: await store.counters.get("devoured") });
}, 5000);

// occasional ambient whisper from The Door — era-aware when an event is running
setInterval(() => {
  const era = world.activeEvent ? world.activeEvent.anim : null;
  const pool = (era && engine.WHISPERS_BY_ERA[era]) ? engine.WHISPERS_BY_ERA[era] : engine.WHISPERS_BY_ERA.default;
  broadcast("whisper", { actor: "The Door", text: pool[Math.floor(Math.random() * pool.length)] });
}, 14000);

// SSE keepalive
setInterval(() => broadcast("ping", { t: Date.now() }), 20000);

// keep long-lived SSE connections alive through proxies/load balancers
server.keepAliveTimeout = 65_000;
server.headersTimeout   = 70_000;
server.requestTimeout   = 0;            // SSE responses never "complete"
server.maxConnections   = MAX_SSE + 200;

server.listen(PORT, HOST, () => {
  console.log(`THE DOOR (server-authoritative skeleton) listening on http://${HOST}:${PORT}`);
  console.log(`health: /healthz | SSE: /api/stream | feed: POST /api/feed | session: POST /api/session`);
});

// graceful shutdown so `docker stop` / orchestrators don't drop users abruptly
function shutdown(sig) {
  console.log(`\n${sig} received — closing ${clients.size} streams and shutting down.`);
  for (const res of clients) { try { res.end(); } catch (_) {} }
  clients.clear();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
