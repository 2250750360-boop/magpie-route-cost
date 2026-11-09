import test from "node:test";
import assert from "node:assert/strict";
import { mergeBooks } from "../lib/unified.mjs";

const route = (name, calls, cost, members, book = "gateway") => ({
  name,
  direct: false,
  calls,
  ok: calls,
  failed: 0,
  cost,
  credits: book === "gateway" ? 10 : 0,
  unpriced: 0,
  input: 100,
  output: 10,
  cacheRead: 0,
  cacheWrite: 0,
  tokens: 110,
  allTokens: 110,
  families: ["kimi"],
  members,
  lastAt: "2026-11-09T10:00:00Z",
  firstAt: "2026-11-09T09:00:00Z",
  share: 0,
  book,
});

const member = (provider, model, calls, cost, book) => ({
  provider,
  providerName: provider,
  model,
  calls,
  ok: calls,
  failed: 0,
  cost,
  credits: 0,
  unpriced: 0,
  input: 100,
  output: 10,
  cacheRead: 0,
  cacheWrite: 0,
  tokens: 110,
  allTokens: 110,
  lastAt: "",
  firstAt: "",
  share: 0,
  avgCost: cost / calls,
  book,
});

test("merges gateway and history into one book with a time boundary", () => {
  const gateway = {
    totals: { calls: 2, ok: 2, failed: 0, cost: 1, credits: 10, unpriced: 0, input: 100, output: 10, cacheRead: 0, cacheWrite: 0, firstAt: "2026-11-06T10:00:00Z" },
    routes: [route("group/a", 2, 1, [member("workbuddy", "deepseek", 2, 1, "gateway")])],
    daily: [{ date: "2026-11-09", calls: 2, cost: 1, tokens: 110 }],
  };
  const cc = {
    totals: { calls: 3, ok: 3, failed: 0, cost: 2, credits: 0, unpriced: 0, input: 200, output: 20, cacheRead: 0, cacheWrite: 0, firstAt: "2026-10-16T10:00:00Z" },
    routes: [route("group/a", 3, 2, [member("kimi", "k3.1-pro", 3, 2, "history")], "history")],
    daily: [{ date: "2026-10-16", calls: 3, cost: 2, tokens: 220 }],
  };
  const data = mergeBooks("all", gateway, cc, { cutoff: "2026-11-06T10:00:00Z" });
  assert.equal(data.totals.calls, 5);
  assert.equal(data.totals.cost, 3);
  assert.equal(data.routes.length, 1);
  assert.equal(data.routes[0].book, "both");
  assert.equal(data.routes[0].members.length, 2);
  assert.equal(data.daily.length, 2);
  assert.equal(data.dedupe.cutoff, "2026-11-06T10:00:00Z");
  assert.equal(data.routes[0].share, 1);
});

test("a route only in one book keeps that book", () => {
  const data = mergeBooks(
    "all",
    { totals: { calls: 1, ok: 1, cost: 1, firstAt: "2026-11-06T10:00:00Z" }, routes: [route("group/a", 1, 1, [member("w", "m", 1, 1, "gateway")])] },
    { totals: { calls: 1, ok: 1, cost: 2 }, routes: [route("k3.1-pro", 1, 2, [member("k", "k3.1-pro", 1, 2, "history")], "history")] },
    { cutoff: "2026-11-06T10:00:00Z" },
  );
  const history = data.routes.find((r) => r.name === "k3.1-pro");
  assert.equal(history.book, "history");
  assert.equal(history.members[0].book, "history");
});
