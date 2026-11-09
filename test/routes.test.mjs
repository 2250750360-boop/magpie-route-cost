import test from "node:test";
import assert from "node:assert/strict";
import { aggregate, family, toCSV } from "../lib/routes.mjs";

const row = (over = {}) => ({
  t: "2026-11-09T12:00:00+08:00",
  provider: "workbuddy",
  providerName: "WorkBuddy",
  model: "deepseek-v4.1-flash",
  req: "group/model-ds-v41-flash",
  served: "deepseek-v4.1-flash",
  in: 100,
  out: 10,
  cache_read: 0,
  cache_write: 0,
  reasoning: 0,
  status: 200,
  cost: 0.0001,
  credits: 0,
  priced: true,
  ...over,
});

test("a route sums its requests and splits them by served model", () => {
  const data = aggregate("today", [
    row(),
    row({ provider: "trae-cn", served: "deepseek-v4.1-flash-max", cost: 0.0002, credits: 1.5 }),
    row({ req: "group/use-daily", served: "QoDuck", provider: "qoder", cost: 0, credits: 0 }),
    row({ req: "group/use-daily", served: "Qwen3.8-Flash", provider: "qoder", cost: 0.00001 }),
  ]);

  assert.equal(data.routes.length, 2);
  const ds = data.routes.find((route) => route.name === "group/model-ds-v41-flash");
  assert.equal(ds.calls, 2);
  assert.equal(ds.members.length, 2);
  assert.equal(ds.members[0].provider, "trae-cn");
  assert.ok(Math.abs(ds.members[0].share - 2 / 3) < 1e-9);

  const daily = data.routes.find((route) => route.name === "group/use-daily");
  assert.deepEqual(daily.families.sort(), ["qoduck", "qwen"]);
  assert.ok(Math.abs(data.totals.cost - 0.00031) < 1e-12);
});

test("calls outside a group route become one direct bucket, kept last", () => {
  const data = aggregate("today", [
    row({ req: "gpt-6.1-sol", served: "gpt-6.1-sol", provider: "codex", cost: 1 }),
    row({ req: "group/a", cost: 0.5 }),
  ]);
  assert.equal(data.routes[0].name, "group/a");
  assert.equal(data.routes[1].direct, true);
  assert.equal(data.routes[1].cost, 1);
  assert.equal(data.totals.cost, 1.5);
});

test("session-file rows never enter the route ledger", () => {
  const data = aggregate("today", [
    row({ provider: "session-unknown", req: "", served: "" }),
    row(),
  ]);
  assert.equal(data.totals.calls, 1);
  assert.equal(data.routes.length, 1);
});

test("unpriced means tokens without a price, not a failed call", () => {
  const data = aggregate("today", [
    row({ priced: false, in: 100 }),
    row({ priced: false, in: 0, out: 0, status: 0 }),
  ]);
  assert.equal(data.totals.unpriced, 1);
  assert.equal(data.totals.failed, 1);
});

test("family names keep model families apart", () => {
  assert.equal(family("Kimi-K3.1-Pro"), "kimi");
  assert.equal(family("kimi-k3.1-pro-max"), "kimi");
  assert.equal(family("kmodel_latest"), "kimi");
  assert.equal(family("deepseek-v4.1-flash"), "deepseek");
  assert.equal(family("Qwen3.8-Flash"), "qwen");
  assert.equal(family("gfmodel"), "glm");
});

test("CSV has one line per member and a BOM", () => {
  const data = aggregate("today", [row(), row({ provider: "trae-cn", cost: 0 })]);
  const csv = toCSV(data);
  assert.ok(csv.startsWith("\ufeffroute,direct,provider,model"));
  assert.equal(csv.trimEnd().split("\r\n").length, 3);
});
