import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gatewayRequestsPage } from "./gateway.mjs";
import { canonicalModel } from "./canonical.mjs";
import { agentKey, agentLabel, isSystemAgent, providerLabel } from "./agents.mjs";

export const DEFAULT_CCSWITCH_DB = join(homedir(), ".cc-switch", "cc-switch.db");

const CC_PROVIDER = {
  kimi_session: "_kimi_session",
  codex_session: "_codex_session",
  dsh_session: "_dsh_session",
  mcode_session: "_mcode_session",
  session_log: "_session",
};

let opened = { path: "", db: null };

async function openDb(path) {
  if (opened.path === path && opened.db) return opened.db;
  if (!existsSync(path)) return null;
  let db;
  try {
    const { Database } = await import("bun:sqlite");
    const raw = new Database(path, { readonly: true });
    db = { all: (sql, params = []) => raw.query(sql).all(...params) };
  } catch {
    const { DatabaseSync } = await import("node:sqlite");
    const raw = new DatabaseSync(path, { readOnly: true });
    db = { all: (sql, params = []) => raw.prepare(sql).all(...params) };
  }
  opened = { path, db };
  return db;
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

function empty() {
  return {
    calls: 0, ok: 0, cost: 0, input: 0, output: 0,
    cacheRead: 0, cacheWrite: 0, outSpeed: 0, decodeMs: 0,
    ttftSum: 0, ttftN: 0,
  };
}

function add(target, row) {
  target.calls += 1;
  if (row.ok) target.ok += 1;
  target.cost += row.cost;
  target.input += row.in;
  target.output += row.out;
  target.cacheRead += row.cacheRead;
  target.cacheWrite += row.cacheWrite;
  if (row.ms > row.ttft && row.ttft > 0) {
    target.outSpeed += row.out;
    target.decodeMs += row.ms - row.ttft;
    target.ttftSum += row.ttft;
    target.ttftN += 1;
  } else if (row.ttft > 0) {
    target.ttftSum += row.ttft;
    target.ttftN += 1;
  }
  return target;
}

function finish(target) {
  target.tokens = target.input + target.output;
  target.allTokens = target.tokens + target.cacheRead + target.cacheWrite;
  target.speed = target.decodeMs > 0 ? target.outSpeed / (target.decodeMs / 1000) : 0;
  target.ttft = target.ttftN > 0 ? target.ttftSum / target.ttftN : 0;
  delete target.outSpeed;
  delete target.decodeMs;
  delete target.ttftSum;
  delete target.ttftN;
  return target;
}

function gatewayRow(row) {
  const agent = agentKey(row.agent);
  const model = String(row.served || row.model || "").trim() || "?";
  return {
    t: Math.floor(new Date(row.t).getTime() / 1000),
    iso: row.t,
    agent,
    agentLabel: agentLabel(agent),
    provider: String(row.provider || "").trim(),
    providerLabel: providerLabel(row.provider),
    model,
    canonical: canonicalModel(model),
    route: String(row.req || "").trim(),
    cost: Number(row.cost) || 0,
    in: Number(row.in) || 0,
    out: Number(row.out) || 0,
    cacheRead: Number(row.cache_read) || 0,
    cacheWrite: Number(row.cache_write) || 0,
    ok: Number(row.status) === 200,
    ms: Number(row.ms) || 0,
    ttft: Number(row.ttft_ms) || 0,
    session: String(row.session || "").trim(),
    source: "gateway",
  };
}

function ccRow(row) {
  const source = String(row.data_source || "").trim();
  const agent = source === "session_log" ? "claude" : agentKey(source);
  const provider = CC_PROVIDER[source] || `_${source || "session"}`;
  const model = String(row.model || "").trim() || "?";
  const created = Number(row.created_at) || 0;
  return {
    t: created,
    iso: new Date(created * 1000).toISOString(),
    agent,
    agentLabel: agentLabel(agent),
    provider,
    providerLabel: providerLabel(provider),
    model,
    canonical: canonicalModel(model),
    route: String(row.request_model || model).trim(),
    cost: Number(row.total_cost_usd) || 0,
    in: Number(row.input_tokens) || 0,
    out: Number(row.output_tokens) || 0,
    cacheRead: Number(row.cache_read_tokens) || 0,
    cacheWrite: Number(row.cache_creation_tokens) || 0,
    ok: Number(row.status_code) === 200,
    ms: Number(row.latency_ms) || 0,
    ttft: Number(row.first_token_ms) || 0,
    session: String(row.session_id || "").trim(),
    source: "cc",
  };
}

let cache = { at: 0, rows: null, rollups: null };

async function loadRows(dbPath) {
  if (cache.rows && Date.now() - cache.at < 45_000) {
    return { rows: cache.rows, rollups: cache.rollups };
  }
  const rows = [];
  let offset = 0;
  let total = Infinity;
  for (let page = 0; page < 80 && offset < total; page += 1) {
    const answer = await gatewayRequestsPage("all", offset);
    if (!Array.isArray(answer?.rows)) break;
    rows.push(...answer.rows);
    offset += answer.rows.length;
    total = Number(answer.total) || rows.length;
    if (!answer.rows.length) break;
  }
  const gateway = rows
    .filter((row) => row.provider && row.provider !== "session-unknown")
    .map(gatewayRow);

  const db = await openDb(dbPath || DEFAULT_CCSWITCH_DB);
  let cc = [];
  let rollups = [];
  if (db) {
    cc = db
      .all(
        `SELECT created_at, data_source, provider_id, session_id, request_model, model,
                input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                total_cost_usd, status_code, latency_ms, first_token_ms
           FROM proxy_request_logs
          ORDER BY created_at`,
      )
      .map(ccRow);
    rollups = db.all(
      `SELECT date, provider_id, model, request_model, request_count,
              input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
              total_cost_usd
         FROM usage_daily_rollups ORDER BY date`,
    );
  }

  const firstByAgent = new Map();
  const gatewaySessions = new Set();
  for (const row of gateway) {
    if (row.session) gatewaySessions.add(row.session);
    const first = firstByAgent.get(row.agent);
    if (first == null || row.t < first) firstByAgent.set(row.agent, row.t);
  }
  const kept = cc.filter((row) => {
    if (row.session && gatewaySessions.has(row.session)) return false;
    const first = firstByAgent.get(row.agent);
    if (first != null && row.t >= first) return false;
    return true;
  });

  const all = [...gateway, ...kept].sort((a, b) => b.t - a.t);
  cache = { at: Date.now(), rows: all, rollups };
  return { rows: all, rollups };
}

export async function loadUsage(period, options = {}) {
  const wanted = ["today", "7d", "30d", "all"].includes(period) ? period : "today";
  const { rows, rollups } = await loadRows(options.dbPath);
  const since = periodStart(wanted);
  const selected = rows.filter((row) => row.t >= since);

  const totals = empty();
  const daily = new Map();
  const models = new Map();
  const providers = new Map();

  const addMember = (map, key, base, row) => {
    let member = map.get(key);
    if (!member) {
      member = { ...base, ...empty() };
      map.set(key, member);
    }
    add(member, row);
    return member;
  };

  for (const row of selected) {
    add(totals, row);
    const day = new Date(row.t * 1000).toISOString().slice(0, 10);
    const cell = daily.get(day) || { date: day, calls: 0, cost: 0, tokens: 0 };
    cell.calls += 1;
    cell.cost += row.cost;
    cell.tokens += row.in + row.out + row.cacheRead + row.cacheWrite;
    daily.set(day, cell);
    if (isSystemAgent(row.agent)) continue;

    const memberAgent = row.agent;
    const memberAgentLabel = memberAgent === "system" ? "System" : row.agentLabel;

    let model = models.get(row.canonical);
    if (!model) {
      model = { name: row.canonical, ...empty(), members: new Map() };
      models.set(row.canonical, model);
    }
    add(model, row);
    addMember(model.members, `${memberAgent}\u001f${row.provider}\u001f${row.model}`, {
      agent: memberAgent,
      agentLabel: memberAgentLabel,
      provider: row.provider,
      providerLabel: row.providerLabel,
      model: row.model,
    }, row);

    let provider = providers.get(row.provider);
    if (!provider) {
      provider = { provider: row.provider, label: row.providerLabel, ...empty(), members: new Map() };
      providers.set(row.provider, provider);
    }
    add(provider, row);
    addMember(provider.members, `${memberAgent}\u001f${row.canonical}\u001f${row.model}`, {
      agent: memberAgent,
      agentLabel: memberAgentLabel,
      model: row.model,
      canonical: row.canonical,
    }, row);
  }

  for (const row of rollups) {
    const created = Math.floor(new Date(`${row.date}T12:00:00`).getTime() / 1000);
    if (created < since) continue;
    const calls = Number(row.request_count) || 0;
    const cost = Number(row.total_cost_usd) || 0;
    const input = Number(row.input_tokens) || 0;
    const output = Number(row.output_tokens) || 0;
    const cacheRead = Number(row.cache_read_tokens) || 0;
    const cacheWrite = Number(row.cache_creation_tokens) || 0;
    const model = String(row.model || row.request_model || "?");
    const canonical = canonicalModel(model);
    const provider = "_session";
    const providerText = providerLabel(provider);
    totals.calls += calls;
    totals.ok += calls;
    totals.cost += cost;
    totals.input += input;
    totals.output += output;
    totals.cacheRead += cacheRead;
    totals.cacheWrite += cacheWrite;
    const cell = daily.get(row.date) || { date: row.date, calls: 0, cost: 0, tokens: 0 };
    cell.calls += calls;
    cell.cost += cost;
    cell.tokens += input + output + cacheRead + cacheWrite;
    daily.set(row.date, cell);

    let entry = models.get(canonical);
    if (!entry) {
      entry = { name: canonical, ...empty(), members: new Map() };
      models.set(canonical, entry);
    }
    entry.calls += calls;
    entry.ok += calls;
    entry.cost += cost;
    entry.input += input;
    entry.output += output;
    entry.cacheRead += cacheRead;
    entry.cacheWrite += cacheWrite;
    const mkey = `system\u001f${provider}\u001f${model}`;
    let member = entry.members.get(mkey);
    if (!member) {
      member = {
        agent: "claude", agentLabel: "Claude", provider, providerLabel: providerText,
        model, ...empty(),
      };
      entry.members.set(mkey, member);
    }
    member.calls += calls; member.ok += calls; member.cost += cost;
    member.input += input; member.output += output;
    member.cacheRead += cacheRead; member.cacheWrite += cacheWrite;

    let prov = providers.get(provider);
    if (!prov) {
      prov = { provider, label: providerText, ...empty(), members: new Map() };
      providers.set(provider, prov);
    }
    prov.calls += calls; prov.ok += calls; prov.cost += cost;
    prov.input += input; prov.output += output;
    prov.cacheRead += cacheRead; prov.cacheWrite += cacheWrite;
    const pkey = `claude${canonical}${model}`;
    let pmember = prov.members.get(pkey);
    if (!pmember) {
      pmember = {
        agent: "claude", agentLabel: "Claude", model, canonical, ...empty(),
      };
      prov.members.set(pkey, pmember);
    }
    pmember.calls += calls; pmember.ok += calls; pmember.cost += cost;
    pmember.input += input; pmember.output += output;
    pmember.cacheRead += cacheRead; pmember.cacheWrite += cacheWrite;
  }

  finish(totals);
  const modelList = [...models.values()]
    .map((model) => {
      finish(model);
      model.members = [...model.members.values()]
        .map((member) => {
          finish(member);
          member.share = model.cost > 0 ? member.cost / model.cost : 0;
          return member;
        })
        .sort((a, b) => b.cost - a.cost || b.calls - a.calls);
      model.share = totals.cost > 0 ? model.cost / totals.cost : 0;
      return model;
    })
    .sort((a, b) => b.cost - a.cost || b.calls - a.calls || a.name.localeCompare(b.name));

  const providerList = [...providers.values()]
    .map((provider) => {
      finish(provider);
      provider.members = [...provider.members.values()]
        .map((member) => {
          finish(member);
          member.share = provider.cost > 0 ? member.cost / provider.cost : 0;
          return member;
        })
        .sort((a, b) => b.cost - a.cost || b.calls - a.calls);
      provider.share = totals.cost > 0 ? provider.cost / totals.cost : 0;
      return provider;
    })
    .sort((a, b) => b.cost - a.cost || b.calls - a.calls);

  return {
    period: wanted,
    generatedAt: new Date().toISOString(),
    source: "Magpie gateway + CC Switch, deduped",
    totals,
    logTotal: selected.length,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    models: modelList,
    providers: providerList,
  };
}

export async function loadLog(period, query = {}, options = {}) {
  const { rows } = await loadRows(options.dbPath);
  const since = periodStart(period);
  let selected = rows.filter((row) => row.t >= since && !isSystemAgent(row.agent));
  if (query.agent) selected = selected.filter((row) => row.agent === query.agent);
  if (query.provider) selected = selected.filter((row) => row.provider === query.provider);
  if (query.model) selected = selected.filter((row) => row.canonical === query.model);
  if (query.q) {
    const q = String(query.q).toLowerCase();
    selected = selected.filter(
      (row) =>
        row.model.toLowerCase().includes(q) ||
        row.agentLabel.toLowerCase().includes(q) ||
        row.providerLabel.toLowerCase().includes(q) ||
        row.route.toLowerCase().includes(q),
    );
  }
  const offset = Math.max(0, Number(query.offset) || 0);
  const limit = Math.min(200, Math.max(20, Number(query.limit) || 100));
  return {
    total: selected.length,
    offset,
    limit,
    rows: selected.slice(offset, offset + limit).map((row) => ({
      time: row.iso,
      agent: row.agent,
      agentLabel: row.agentLabel,
      provider: row.provider,
      providerLabel: row.providerLabel,
      model: row.model,
      canonical: row.canonical,
      route: row.route,
      cost: row.cost,
      tokens: row.in + row.out + row.cacheRead + row.cacheWrite,
      ok: row.ok,
      speed: row.ms > row.ttft && row.ttft > 0 ? row.out / ((row.ms - row.ttft) / 1000) : 0,
      ttft: row.ttft,
    })),
  };
}
