// A model price list: one row per provider model, with the routes that use
// it. Magpie's gateway already knows each effective price; its local config
// knows which groups point at which models. Both are read-only here.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalModel } from "./canonical.mjs";

export function configDir() {
  return process.env.MAGPIE_CONFIG_DIR || join(homedir(), ".config", "magpie");
}

function readJson(name, fallback) {
  try {
    return JSON.parse(readFileSync(join(configDir(), name), "utf8"));
  } catch {
    return fallback;
  }
}

function perMillion(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1_000_000 * 10_000) / 10_000 : null;
}

function cleanName(value, fallback) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text
    .replace(/^模型\s*[|｜]\s*/, "")
    .replace(/^Model\s*[|｜]\s*/i, "")
    .trim() || fallback;
}

export function buildPricing(modelsPayload, options = {}) {
  const list = Array.isArray(modelsPayload?.data) ? modelsPayload.data : [];
  const providers = readJson("providers.json", { providers: [], groups: [] });
  const settings = readJson("settings.json", {});
  const overrides = settings.modelPrices && typeof settings.modelPrices === "object"
    ? settings.modelPrices
    : {};
  const providerNames = new Map(
    (providers.providers || []).map((p) => [p.id, p.name || p.id]),
  );
  const groups = (providers.groups || []).filter(
    (g) => Array.isArray(g.members) && g.members.length,
  );

  // member id -> the groups that list it. Group members can themselves be
  // "group/<id>", so the same map answers "which parent routes include this".
  const parents = new Map();
  for (const group of groups) {
    for (const member of group.members) {
      const key = String(member || "").trim();
      if (!key) continue;
      const listOf = parents.get(key) || [];
      listOf.push(group.id);
      parents.set(key, listOf);
    }
  }

  function routesFor(id) {
    const found = new Set();
    const queue = [id];
    const seen = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      for (const parent of parents.get(current) || []) {
        if (found.has(parent)) continue;
        found.add(parent);
        // A group used by another group is referenced as group/<id>.
        queue.push(`group/${parent}`);
      }
    }
    return [...found].sort();
  }

  const models = [];
  for (const entry of list) {
    const id = String(entry?.id || "").trim();
    if (!id || id.startsWith("group/")) continue;
    const slash = id.indexOf("/");
    if (slash < 1) continue;
    const provider = id.slice(0, slash);
    const model = id.slice(slash + 1);
    const pricing = entry.pricing && typeof entry.pricing === "object" ? entry.pricing : {};
    const usd = {
      input: perMillion(pricing.prompt),
      output: perMillion(pricing.completion),
      cacheRead: perMillion(pricing.input_cache_read) ?? 0,
      cacheWrite: perMillion(pricing.input_cache_write) ?? 0,
    };
    const priced = usd.input != null && usd.output != null;
    const custom = Boolean(overrides[id] || overrides[`*/${model}`]);
    models.push({
      id,
      provider,
      providerName: providerNames.get(provider) || provider,
      name: cleanName(entry.display_name, model),
      model,
      canonical: canonicalModel(model || entry.display_name),
      context: Number(entry.context_length) || 0,
      priced,
      usd: priced ? usd : null,
      custom,
      free: priced && usd.input === 0 && usd.output === 0,
      routes: routesFor(id),
    });
  }

  // Two used models are not in /v1/models because their provider is only
  // known from session history; take their list prices from CC Switch's table.
  const extras = [
    { id: "_session/claude-opus-5-5", provider: "_session", providerName: "Session history",
      name: "Claude Opus 5.5", model: "claude-opus-5-5", canonical: "Claude Opus 5.5",
      context: 0, priced: true, usd: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      custom: false, free: false, routes: [] },
    { id: "tabbit/LongCat-2.0", provider: "tabbit", providerName: "Tabbit",
      name: "LongCat 2.0", model: "LongCat-2.0", canonical: "LongCat 2.0",
      context: 0, priced: true, usd: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
      custom: false, free: false, routes: [] },
  ];
  for (const extra of extras) {
    if (!models.some((m) => m.provider === extra.provider && m.model === extra.model)) {
      models.push(extra);
    }
  }

  models.sort(
    (a, b) =>
      b.routes.length - a.routes.length ||
      a.providerName.localeCompare(b.providerName) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );

  return {
    generatedAt: new Date().toISOString(),
    rate: Number(options.usdCny) || 6.8,
    models,
  };
}
