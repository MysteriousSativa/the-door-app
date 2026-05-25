"use strict";
/* ============================================================================
 * store.js — in-memory stores behind a swappable interface.
 *
 * Everything here is intentionally simple and synchronous so the prototype runs
 * with zero dependencies. The METHOD SHAPES are chosen to map 1:1 onto a real
 * backend so production is a drop-in swap, not a rewrite:
 *
 *   counters.incr(key, n)   ->  Redis INCRBY key n
 *   counters.get(key)       ->  Redis GET key
 *   leaderboard.add(id, n)  ->  Redis ZINCRBY board n id
 *   leaderboard.top(n)      ->  Redis ZREVRANGE board 0 n-1 WITHSCORES
 *   leaderboard.rankOf(id)  ->  Redis ZREVRANK board id
 *   sessions.get/set        ->  Postgres row / Redis hash
 *   ledger.seen(nonce)      ->  Redis SET NX (idempotency key, TTL)
 *
 * Swap this one file for a Redis/Postgres-backed version and the rest of the
 * app is unchanged. Keep the async option open: callers already `await`.
 * ==========================================================================*/

class Counters {
  constructor() { this.map = new Map(); }
  async incr(key, n = 1) { const v = (this.map.get(key) || 0) + n; this.map.set(key, v); return v; }
  async get(key) { return this.map.get(key) || 0; }
}

class Leaderboard {
  // A naive sorted-set stand-in. In prod this is a Redis Sorted Set (O(log n)).
  constructor() { this.scores = new Map(); this.meta = new Map(); }
  async add(id, delta, meta) { const v = (this.scores.get(id) || 0) + delta; this.scores.set(id, v);
    if (meta) this.meta.set(id, Object.assign(this.meta.get(id) || {}, meta)); return v; }
  async set(id, score, meta) { this.scores.set(id, score); if (meta) this.meta.set(id, meta); }
  async scoreOf(id) { return this.scores.get(id) || 0; }
  async top(n) {
    const arr = [...this.scores.entries()].sort((a, b) => b[1] - a[1]);
    return arr.slice(0, n).map(([id, score], i) =>
      Object.assign({ id, score, position: i + 1 }, this.meta.get(id) || {}));
  }
  async rankOf(id) {
    const arr = [...this.scores.entries()].sort((a, b) => b[1] - a[1]);
    const idx = arr.findIndex(([k]) => k === id);
    return idx < 0 ? null : idx + 1;
  }
  async size() { return this.scores.size; }
}

class Sessions {
  constructor() { this.map = new Map(); }
  async get(id) { return this.map.get(id) || null; }
  async set(id, session) { this.map.set(id, session); return session; }
  async all() { return [...this.map.values()]; }
}

class Ledger {
  // Idempotency + an append-only feed log. In prod: Redis SET NX + cached
  // response body for the nonce (with TTL) and a durable Postgres table for
  // settlement/audit. A duplicate should recover the original result, not just
  // say "duplicate", because the first HTTP response may have been dropped.
  constructor() { this.results = new Map(); this.feeds = []; this.MAX = 5000; }
  prune() {
    if (this.results.size <= this.MAX) return;
    const cutoff = Date.now() - 5 * 60_000;
    for (const [k, v] of this.results) if (v.at < cutoff) this.results.delete(k);
  }
  async result(nonce) {
    if (!nonce) return null;
    return this.results.get(nonce) || null;
  }
  async recordResult(nonce, code, body) {
    if (!nonce) return;
    this.results.set(nonce, { at: Date.now(), code, body });
    this.prune();
  }
  async record(feed) { this.feeds.push(feed); if (this.feeds.length > this.MAX) this.feeds.shift(); }
}

module.exports = {
  counters: new Counters(),
  leaderboard: new Leaderboard(),
  sessions: new Sessions(),
  ledger: new Ledger(),
};
