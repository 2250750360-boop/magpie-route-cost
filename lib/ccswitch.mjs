// CC Switch keeps its own ledger in a local SQLite database. This module
// reads it without writing: no import, no merge, no second price table.
// The rows are shown as a separate book because they overlap Magpie's and
// use different token semantics; adding the two totals would count the same
// work twice.

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { family } from "./routes.mjs";
import { canonicalModel } from "./canonical.mjs";

export const DEFAULT_CCSWITCH_DB = join(homedir(), ".cc-switch", "cc-switch.db");

let opened = { path: "", db: null };

function wrapBun(db) {
  return {
    all(sql, params = []) {
      return db.query(sql).all(...params);
    },
  };
}

function wrapNode(db) {
  return {
    all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
  };
}

async function openDb(path) {
  if (opened.path === path && opened.db) return opened.db;
  if (!existsSync(path)) return null;
  let db;
  try {
    const { Database } = await import("bun:sqlite");
    db = wrapBun(new Database(path, { readonly: true }));
  } catch {
    const { DatabaseSync } = await import("node:sqlite");
    db = wrapNode(new DatabaseSync(path, { readOnly: true }));
  }
  opened = { path, db };
  return db;
}

export async function ccswitchAvailable(path = DEFAULT_CCSWITCH_DB) {
  return existsSync(path);
}

function periodStart(period) {
  const now = new Date();
  if (period === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return Math.floor(start.getTime() / 1000);
  }
  if (period === "7d") return Math.floor((now.getTime() - 7 * 86400_000) / 1000);
  if (period === "30d") return Math.floor((now.getTime() - 30 * 86400_000) / 1000);
  return 0;
}

function blank() {
  return {
    calls: 0,
    ok: 0,
    failed: 0,
    cost: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    lastAt: "",
    firstAt: "",
  };
}

function add(target, row) {
  target.calls += 1;
  if (Number(row.status_code) === 200) target.ok += 1;
  else target.failed += 1;
  target.cost += Number(row.total_cost_usd) || 0;
  target.input += Number(row.input_tokens) || 0;
  target.output += Number(row.output_tokens) || 0;
  target.cacheRead += Number(row.cache_read_tokens) || 0;
  target.cacheWrite += Number(row.cache_creation_tokens) || 0;
  const at = Number(row.created_at) || 0;
  if (at) {
    const iso = new Date(at * 1000).toISOString();
    if (!target.lastAt || iso > target.lastAt) target.lastAt = iso;
    if (!target.firstAt || iso < target.firstAt) target.firstAt = iso;
  }
  return target;
}

function finish(target) {
  target.tokens = target.input + target.output;
  target.allTokens = target.tokens + target.cacheRead + target.cacheWrite;
  return target;
}

function agentFromSource(source) {
  const s = String(source || "").toLowerCase();
  if (s.startsWith("kimi")) return "Kimi Code";
  if (s === "dsh_session") return "DSH";
  if (s === "codex_session") return "Codex";
  if (s === "mcode_session") return "MCode";
  if (s === "session_log") return "Session";
  return source || "Unknown";
}

function nameOf(row) {
  return (
    String(row.request_model || "").trim() ||
    String(row.model || "").trim() ||
    "(unknown)"
  );
}

export function aggregateCc(period, rows, rollups, options = {}) {
  const magpieSessions = options.magpieSessions || new Set();
  const routes = new Map();
  const total = blank();
  const sessions = new Set();
  let overlapRows = 0;
  let overlapCost = 0;
  let from = "";
  let to = "";
  const daily = new Map();

  for (const row of rows) {
    const session = String(row.session_id || "").trim();
    if (session) sessions.add(session);
    const isOverlap = Boolean(session) && magpieSessions.has(session);
    if (isOverlap) {
      overlapRows += 1;
      overlapCost += Number(row.total_cost_usd) || 0;
    }
    add(total, row);

    const createdAt = Number(row.created_at) || 0;
    if (createdAt) {
      const when = new Date(createdAt * 1000);
      const day = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`;
      const cell = daily.get(day) || { date: day, calls: 0, cost: 0, tokens: 0 };
      cell.calls += 1;
      cell.cost += Number(row.total_cost_usd) || 0;
      cell.tokens +=
        (Number(row.input_tokens) || 0) +
        (Number(row.output_tokens) || 0) +
        (Number(row.cache_read_tokens) || 0) +
        (Number(row.cache_creation_tokens) || 0);
      daily.set(day, cell);
    }

    const name = nameOf(row);
    const provider = String(row.provider_id || "").trim() || "(unknown)";
    const source = String(row.data_source || "").trim() || "(unknown)";
    const model = String(row.model || "").trim() || name;

    if (createdAt) {
      const iso = new Date(createdAt * 1000).toISOString();
      if (!from || iso < from) from = iso;
      if (!to || iso > to) to = iso;
    }

    let route = routes.get(name);
    if (!route) {
      route = {
        name,
        direct: false,
        ...blank(),
        families: new Set(),
        members: new Map(),
        sources: new Map(),
        overlap: 0,
        overlapCost: 0,
      };
      routes.set(name, route);
    }
    add(route, row);
    route.families.add(family(model));
    route.sources.set(source, (route.sources.get(source) || 0) + 1);
    if (isOverlap) {
      route.overlap += 1;
      route.overlapCost += Number(row.total_cost_usd) || 0;
    }

    const agent = agentFromSource(source);
    const key = `${agent}\u001f${provider}\u001f${model}`;
    let member = route.members.get(key);
    if (!member) {
      member = {
        agent,
        provider,
        providerName: source,
        model,
        canonical: canonicalModel(model),
        ...blank(),
        overlap: 0,
      };
      route.members.set(key, member);
    }
    add(member, row);
    if (isOverlap) member.overlap += 1;
  }

  // CC Switch also keeps a few daily rollup rows that never went through the
  // request log (Claude history before it synced sessions). They are part of
  // its total, so they are part of this book too.
  for (const row of rollups || []) {
    const calls = Number(row.request_count) || 0;
    const cost = Number(row.total_cost_usd) || 0;
    const input = Number(row.input_tokens) || 0;
    const output = Number(row.output_tokens) || 0;
    const cacheRead = Number(row.cache_read_tokens) || 0;
    const cacheWrite = Number(row.cache_creation_tokens) || 0;
    const name = nameOf(row);
    const provider = String(row.provider_id || "").trim() || "(unknown)";
    const model = String(row.model || "").trim() || name;

    total.calls += calls;
    total.ok += calls;
    total.cost += cost;
    total.input += input;
    total.output += output;
    total.cacheRead += cacheRead;
    total.cacheWrite += cacheWrite;

    let route = routes.get(name);
    if (!route) {
      route = {
        name,
        direct: false,
        ...blank(),
        families: new Set(),
        members: new Map(),
        sources: new Map(),
        overlap: 0,
        overlapCost: 0,
      };
      routes.set(name, route);
    }
    route.calls += calls;
    route.ok += calls;
    route.cost += cost;
    route.input += input;
    route.output += output;
    route.cacheRead += cacheRead;
    route.cacheWrite += cacheWrite;
    route.families.add(family(model));
    route.sources.set("daily_rollups", (route.sources.get("daily_rollups") || 0) + calls);

    const key = `${provider}\u001frollup\u001f${model}`;
    let member = route.members.get(key);
    if (!member) {
      member = {
        agent: "Claude",
        provider,
        providerName: "daily_rollups",
        model,
        canonical: canonicalModel(model),
        ...blank(),
        overlap: 0,
      };
      route.members.set(key, member);
    }
    member.calls += calls;
    member.ok += calls;
    member.cost += cost;
    member.input += input;
    member.output += output;
    member.cacheRead += cacheRead;
    member.cacheWrite += cacheWrite;

    const day = String(row.date || "").slice(0, 10);
    if (day) {
      const cell = daily.get(day) || { date: day, calls: 0, cost: 0, tokens: 0 };
      cell.calls += calls;
      cell.cost += cost;
      cell.tokens += input + output + cacheRead + cacheWrite;
      daily.set(day, cell);
    }
  }

  const out = [];
  for (const route of routes.values()) {
    finish(route);
    const sources = [...route.sources.entries()].sort((a, b) => b[1] - a[1]);
    const members = [...route.members.values()]
      .map((member) => {
        finish(member);
        member.share = route.cost > 0 ? member.cost / route.cost : 0;
        member.avgCost = member.calls ? member.cost / member.calls : 0;
        member.credits = 0;
        member.unpriced = 0;
        return member;
      })
      .sort((a, b) => b.cost - a.cost || b.calls - a.calls);
    out.push({
      name: route.name,
      direct: false,
      calls: route.calls,
      ok: route.ok,
      failed: route.failed,
      cost: route.cost,
      credits: 0,
      unpriced: 0,
      input: route.input,
      output: route.output,
      cacheRead: route.cacheRead,
      cacheWrite: route.cacheWrite,
      tokens: route.tokens,
      allTokens: route.allTokens,
      families: [...route.families].sort(),
      members,
      lastAt: route.lastAt,
      avgCost: route.calls ? route.cost / route.calls : 0,
      share: 0,
      source: sources[0]?.[0] || "",
      overlap: route.overlap,
      overlapCost: route.overlapCost,
    });
  }
  out.sort((a, b) => b.cost - a.cost || b.calls - a.calls);
  finish(total);
  total.avgCost = total.calls ? total.cost / total.calls : 0;
  for (const route of out) route.share = total.cost > 0 ? route.cost / total.cost : 0;

  return {
    period,
    generatedAt: new Date().toISOString(),
    source: "CC Switch history",
    totals: total,
    routes: out,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    cc: {
      db: options.dbPath || DEFAULT_CCSWITCH_DB,
      sessions: sessions.size,
      overlapRows,
      overlapCost,
      from,
      to,
      note:
        "CC Switch's own ledger. It overlaps Magpie's: the same sessions can appear in both, and its token semantics differ, so the two totals must not be added.",
    },
  };
}

export async function loadCcHistory(period, options = {}) {
  const wanted = ["today", "7d", "30d", "all"].includes(period) ? period : "today";
  const dbPath = options.dbPath || process.env.MAGPIE_ROUTE_COST_CCSWITCH_DB || DEFAULT_CCSWITCH_DB;
  const db = await openDb(dbPath);
  if (!db) {
    return {
      period: wanted,
      generatedAt: new Date().toISOString(),
      source: "CC Switch history",
      totals: blank(),
      routes: [],
      cc: { available: false, db: dbPath, note: "No local CC Switch database was found." },
    };
  }

  const since = periodStart(wanted);
  const until = Number(options.until) || 0;
  const where = until ? "created_at >= ? AND created_at < ?" : "created_at >= ?";
  const params = until ? [since, until] : [since];
  const rows = db.all(
    `SELECT request_id, provider_id, app_type, model, request_model,
            input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
            total_cost_usd, created_at, data_source, session_id, status_code
       FROM proxy_request_logs
      WHERE ${where}
      ORDER BY created_at`,
    params,
  );

  // Rollups carry a date (YYYY-MM-DD), not an epoch.
  const sinceDate = new Date(since * 1000).toISOString().slice(0, 10);
  const untilDate = until ? new Date(until * 1000).toISOString().slice(0, 10) : "";
  const rollupWhere = untilDate ? "date >= ? AND date < ?" : "date >= ?";
  const rollupParams = untilDate ? [sinceDate, untilDate] : [sinceDate];
  const rollups = db.all(
    `SELECT date, provider_id, model, request_model, request_count,
            input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
            total_cost_usd
       FROM usage_daily_rollups
      WHERE ${rollupWhere}
      ORDER BY date`,
    rollupParams,
  );

  const data = aggregateCc(wanted, rows, rollups, {
    magpieSessions: options.magpieSessions || new Set(),
    dbPath,
  });
  data.cc.available = true;
  data.cc.rows = rows.length;
  data.cc.rollups = rollups.length;
  try {
    const stat = statSync(dbPath);
    data.cc.updatedAt = new Date(stat.mtimeMs).toISOString();
  } catch {
    // The mtime is only a hint.
  }
  return data;
}
