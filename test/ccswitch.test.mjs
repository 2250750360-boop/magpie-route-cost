import test from "node:test";
import assert from "node:assert/strict";
import { aggregateCc } from "../lib/ccswitch.mjs";

const row = (over = {}) => ({
  provider_id: "kimi",
  data_source: "kimi_session",
  model: "kimi-k3.1-pro",
  request_model: "group/model-kimi-k31-other",
  input_tokens: 100,
  output_tokens: 10,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  total_cost_usd: 0.01,
  created_at: 1794200000,
  session_id: "session-a",
  status_code: 200,
  ...over,
});

test("CC rows keep their own total and session count", () => {
  const data = aggregateCc("today", [row(), row({ session_id: "session-b", total_cost_usd: 0.02 })], []);
  assert.equal(data.totals.calls, 2);
  assert.equal(data.totals.cost, 0.03);
  assert.equal(data.cc.sessions, 2);
  assert.equal(data.routes.length, 1);
  assert.equal(data.routes[0].name, "group/model-kimi-k31-other");
});

test("overlap is counted against Magpie session ids", () => {
  const data = aggregateCc(
    "today",
    [row(), row({ session_id: "session-b", total_cost_usd: 0.02 })],
    [],
    { magpieSessions: new Set(["session-a"]) },
  );
  assert.equal(data.cc.overlapRows, 1);
  assert.equal(data.cc.overlapCost, 0.01);
  assert.equal(data.routes[0].overlap, 1);
  const member = data.routes[0].members[0];
  assert.equal(member.overlap, 1);
});

test("daily rollups join the totals without a session", () => {
  const data = aggregateCc(
    "all",
    [row()],
    [
      {
        provider_id: "_session",
        model: "claude-opus-5-5",
        request_model: "claude-opus-5-5",
        request_count: 49,
        input_tokens: 1000,
        output_tokens: 100,
        cache_read_tokens: 10,
        cache_creation_tokens: 1,
        total_cost_usd: 18.4,
      },
    ],
  );
  assert.equal(data.totals.calls, 50);
  assert.ok(Math.abs(data.totals.cost - 18.41) < 1e-9);
  assert.equal(data.totals.failed, 0);
  const claude = data.routes.find((route) => route.name === "claude-opus-5-5");
  assert.equal(claude.calls, 49);
  assert.equal(claude.source, "daily_rollups");
});

test("members split by provider and data source", () => {
  const data = aggregateCc(
    "today",
    [row(), row({ provider_id: "dsh", data_source: "dsh_session", model: "deepseek-flash", request_model: "deepseek-flash", total_cost_usd: 0.5 })],
    [],
  );
  assert.equal(data.routes.length, 2);
  const dsh = data.routes.find((route) => route.name === "deepseek-flash");
  assert.equal(dsh.members[0].provider, "dsh");
  assert.equal(dsh.members[0].providerName, "dsh_session");
});
