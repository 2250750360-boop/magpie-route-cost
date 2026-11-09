// Costs are additive. Magpie records the model that actually served every
// request and the price it applied, so a route's cost is the sum of its
// requests, and a member's share is the part of that sum it served. This
// file only groups and sorts those rows; it never prices anything itself.

import { PAGE_SIZE, gatewayRequestsPage } from "./gateway.mjs";
import { canonicalModel } from "./canonical.mjs";

export const PERIODS = new Set(["today", "7d", "30d", "all"]);
export const DIRECT_KEY = "__direct__";

const FAMILIES = [
  ["kimi", "kimi"],
  ["k3d1", "kimi"],
  ["kmodel", "kimi"],
  ["deepseek", "deepseek"],
  ["dfmodel", "deepseek"],
  ["qwen", "qwen"],
  ["qfmodel", "qwen"],
  ["qmodel", "qwen"],
  ["glm", "glm"],
  ["gfmodel", "glm"],
  ["gmodel", "glm"],
  ["mimo", "mimo"],
  ["doubao", "doubao"],
  ["seed", "doubao"],
  ["gpt", "gpt"],
  ["claude", "claude"],
  ["minimax", "minimax"],
  ["longcat", "longcat"],
  ["hunyuan", "hunyuan"],
  ["hy4", "hunyuan"],
  ["smodel", "sonus"],
  ["lmodel", "qoduck"],
  ["qoduck", "qoduck"],
];

function text(value) {
  return value == null ? "" : String(value).trim();
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function family(name) {
  const s = text(name).toLowerCase();
  for (const [key, label] of FAMILIES) {
    if (s.includes(key)) return label;
  }
  return s || "?";
}

function blank() {
  return {
    calls: 0,
    ok: 0,
    failed: 0,
    cost: 0,
    credits: 0,
    unpriced: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    lastAt: "",
    firstAt: "",
  };
}

function add(target, row) {
  const input = number(row.in);
  const output = number(row.out);
  const cacheRead = number(row.cache_read);
  const cacheWrite = number(row.cache_write);
  target.calls += 1;
  if (number(row.status) === 200) target.ok += 1;
  else target.failed += 1;
  target.cost += number(row.cost);
  target.credits += number(row.credits);
  target.input += input;
  target.output += output;
  target.cacheRead += cacheRead;
  target.cacheWrite += cacheWrite;
  target.reasoning += number(row.reasoning);
  // Magpie's own definition: a request that used tokens and has no price is
  // unpriced. A failed request has no tokens and is not a pricing gap.
  if (row.priced === false && input + output + cacheRead + cacheWrite > 0) {
    target.unpriced += 1;
  }
  const at = text(row.t);
  if (at && at > target.lastAt) target.lastAt = at;
  if (at && (!target.firstAt || at < target.firstAt)) target.firstAt = at;
  return target;
}

function finish(target) {
  target.tokens = target.input + target.output;
  target.allTokens = target.tokens + target.cacheRead + target.cacheWrite;
  return target;
}

function routeName(row) {
  const req = text(row.req);
  return req.startsWith("group/") ? req : DIRECT_KEY;
}

function isGateway(row) {
  const provider = text(row.provider);
  // Session-file rows are a separate universe: they have no provider, no
  // served model and no route, and Magpie deliberately leaves them unpriced.
  return Boolean(provider) && provider !== "session-unknown";
}

export function aggregate(period, rows, meta = null) {
  const routes = new Map();
  const total = blank();
  const sessionIds = new Set();
  const daily = new Map();

  for (const row of rows) {
    const session = text(row.session);
    if (session) sessionIds.add(session);
    if (!isGateway(row)) continue;
    add(total, row);

    const day = text(row.t).slice(0, 10);
    if (day) {
      const cell = daily.get(day) || { date: day, calls: 0, cost: 0, tokens: 0 };
      cell.calls += 1;
      cell.cost += number(row.cost);
      cell.tokens +=
        number(row.in) + number(row.out) + number(row.cache_read) + number(row.cache_write);
      daily.set(day, cell);
    }

    const name = routeName(row);
    let route = routes.get(name);
    if (!route) {
      route = {
        name,
        direct: name === DIRECT_KEY,
        ...blank(),
        families: new Set(),
        members: new Map(),
      };
      routes.set(name, route);
    }
    add(route, row);

    const model = text(row.served) || text(row.model) || "?";
    route.families.add(family(model));

    const provider = text(row.provider);
    const agent = text(row.agent);
    const key = `${agent}\u001f${provider}\u001f${model}`;
    let member = route.members.get(key);
    if (!member) {
      member = {
        agent,
        provider,
        providerName: text(row.providerName) || provider,
        model,
        canonical: canonicalModel(model),
        ...blank(),
      };
      route.members.set(key, member);
    }
    add(member, row);
  }

  const out = [];
  for (const route of routes.values()) {
    finish(route);
    const members = [...route.members.values()]
      .map((member) => {
        finish(member);
        member.share = route.cost > 0 ? member.cost / route.cost : 0;
        member.avgCost = member.calls ? member.cost / member.calls : 0;
        return member;
      })
      .sort((a, b) => b.cost - a.cost || b.calls - a.calls || a.model.localeCompare(b.model));
    out.push({
      name: route.name,
      direct: route.direct,
      calls: route.calls,
      ok: route.ok,
      failed: route.failed,
      cost: route.cost,
      credits: route.credits,
      unpriced: route.unpriced,
      input: route.input,
      output: route.output,
      cacheRead: route.cacheRead,
      cacheWrite: route.cacheWrite,
      reasoning: route.reasoning,
      tokens: route.tokens,
      allTokens: route.allTokens,
      families: [...route.families].sort(),
      members,
      lastAt: route.lastAt,
      avgCost: route.calls ? route.cost / route.calls : 0,
      share: 0,
    });
  }

  out.sort((a, b) => {
    if (a.direct !== b.direct) return a.direct ? 1 : -1;
    return b.cost - a.cost || b.calls - a.calls || a.name.localeCompare(b.name);
  });
  finish(total);
  for (const route of out) route.share = total.cost > 0 ? route.cost / total.cost : 0;
  total.avgCost = total.calls ? total.cost / total.calls : 0;

  const through = meta?.through && typeof meta.through === "object" ? meta.through : null;
  return {
    period,
    generatedAt: new Date().toISOString(),
    source: "Magpie gateway usage",
    totals: total,
    routes: out,
    gateway: through
      ? {
          calls: number(through.calls),
          cost: number(through.cost),
          credits: number(through.credits),
          unpriced: number(through.unpriced),
        }
      : null,
    notes: {
      pricing: "Official list price equivalent, not cash spend.",
      calls: "Calls include failed requests; tokens and cost come from Magpie's ledger.",
    },
    sessionIds: [...sessionIds],
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export async function loadRouteCost(period, options = {}) {
  const wanted = PERIODS.has(period) ? period : "today";
  const fetchPage = options.fetchPage || gatewayRequestsPage;
  const rows = [];
  let offset = 0;
  let total = Infinity;
  let meta = null;
  // A period grows while it is read. The bound stops a moving total from
  // keeping one page open forever; 500 rows is Magpie's own maximum.
  const maxPages = Number.isInteger(options.maxPages) ? options.maxPages : 90;

  for (let page = 0; page < maxPages && offset < total; page += 1) {
    const answer = await fetchPage(wanted, offset, options);
    if (!meta) meta = answer;
    const list = Array.isArray(answer?.rows) ? answer.rows : [];
    rows.push(...list);
    offset += list.length;
    total = Number(answer?.total) || rows.length;
    if (!list.length) break;
  }

  const data = aggregate(wanted, rows, meta);
  data.read = { rows: rows.length, pageSize: PAGE_SIZE, pages: Math.ceil(offset / PAGE_SIZE) };
  return data;
}

function csvCell(value) {
  const textValue = value == null ? "" : String(value);
  return /[",\r\n]/.test(textValue) ? `"${textValue.replaceAll('"', '""')}"` : textValue;
}

export function toCSV(data, options = {}) {
  const rate = Number(options.usdCny) || 6.8;
  const head = [
    "route",
    "direct",
    "provider",
    "model",
    "calls",
    "failed",
    "cost_usd",
    "cost_cny",
    "unpriced",
    "avg_cost_usd",
    "share",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "last_at",
  ];
  const lines = [head.join(",")];
  for (const route of data.routes) {
    for (const member of route.members) {
      lines.push(
        [
          route.direct ? "direct" : route.name,
          route.direct ? "1" : "0",
          member.provider,
          member.model,
          member.calls,
          member.failed,
          member.cost.toFixed(6),
          (member.cost * rate).toFixed(4),
          member.unpriced,
          member.avgCost.toFixed(6),
          (member.share * 100).toFixed(2),
          member.input,
          member.output,
          member.cacheRead,
          member.cacheWrite,
          member.lastAt,
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return `\ufeff${lines.join("\r\n")}\r\n`;
}
