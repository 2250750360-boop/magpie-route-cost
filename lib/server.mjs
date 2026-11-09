import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRouteCost, PERIODS, toCSV } from "./routes.mjs";
import { loadCcHistory } from "./ccswitch.mjs";
import { mergeBooks } from "./unified.mjs";
import { gatewayModels } from "./gateway.mjs";
import { buildPricing } from "./pricing.mjs";
import { loadUsage, loadLog } from "./usage.mjs";

const UI_DIR = fileURLToPath(new URL("../ui/", import.meta.url));
const CACHE_MS = 45_000;
export const PLUGIN_NAME = "magpie-route-cost";

export function version() {
  try {
    const raw = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    );
    return typeof raw.version === "string" ? raw.version : "0";
  } catch {
    return "0";
  }
}

let cachedBuild = "";

export const BUILD_FILES = Object.freeze([
  "server.mjs",
  "routes.mjs",
  "gateway.mjs",
  "ccswitch.mjs",
  "unified.mjs",
  "pricing.mjs",
  "canonical.mjs",
  "usage.mjs",
  "agents.mjs",
  "../index.mjs",
  "../serve.mjs",
  "../package.json",
  "../page/index.html",
  "../page/boot.js",
  "../page/icon.svg",
  "../ui/app.html",
  "../ui/app.js",
  "../ui/style.css",
]);

// A version alone cannot tell a rebuilt local plugin from the code already
// loaded in the host. Hash every runtime asset as well, so a same-version but
// changed build is never mistaken for the running one.
export function buildId() {
  if (cachedBuild) return cachedBuild;
  try {
    const base = new URL("./", import.meta.url);
    const hash = createHash("sha256");
    for (const name of BUILD_FILES) {
      hash.update(name);
      hash.update("\0");
      hash.update(readFileSync(fileURLToPath(new URL(name, base))));
    }
    cachedBuild = hash.digest("hex").slice(0, 16);
  } catch {
    cachedBuild = `version:${version()}`;
  }
  return cachedBuild;
}

const ICONS = new Set([
  "alibaba.svg", "bytedance.svg", "claude.svg", "deepseek.svg", "doubao.svg",
  "hunyuan.svg", "kimi.svg", "longcat-color.svg", "minimax.svg", "openai.svg",
  "qwen.svg", "tencent.svg", "xiaomimimo.svg", "zhipu.svg",
  "qoder.svg", "trae.svg", "workbuddy-color.svg",
]);

const STATIC = new Map([
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  // The page's own icon lives beside the launcher, not in ui/.
  ["/icon.svg", ["../page/icon.svg", "image/svg+xml"]],
]);

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function allowedOrigin(origin, port) {
  if (!origin || origin === "null") return true;
  return (
    origin === `http://127.0.0.1:${port}` ||
    origin === `http://localhost:${port}` ||
    origin === `http://[::1]:${port}`
  );
}

// A plugin page is a sandboxed frame, so it reaches this service with an
// opaque origin ("null"). Its own token still guards the data; these headers
// only let that frame read the answer it asked for.
function allowNullOrigin(req, res) {
  if (req.headers.origin === "null") {
    res.setHeader("Access-Control-Allow-Origin", "null");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "x-route-cost-token");
    res.setHeader("Vary", "Origin");
  }
}

function allowedHost(host, port) {
  const value = String(host || "").toLowerCase();
  return (
    value === `127.0.0.1:${port}` ||
    value === `localhost:${port}` ||
    value === `[::1]:${port}`
  );
}

function escHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseTokens(raw) {
  if (!raw) return {};
  try {
    const value = JSON.parse(Buffer.from(String(raw), "base64").toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (/^[a-z0-9-]{1,40}$/i.test(key) && typeof item === "string" && item.length <= 160) {
        out[key] = item;
      }
    }
    return out;
  } catch {
    return {};
  }
}

// Asks an already running copy of this page's service whether it is up, and
// whether it is the same build. The plugin host and a manual `serve.mjs` can
// both load this plugin; one wins the port and the other treats it as success.
async function probeService(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(1200),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const body = await res.json();
    if (!body || body.name !== PLUGIN_NAME) return null;
    return { reused: true, version: body.version || "", build: body.build || "" };
  } catch {
    return null;
  }
}

// A random token per start would make an open page fail whenever the plugin
// restarts (install, update, toggle). One token kept beside Magpie's cache
// survives that; the page still gets it only from its own served HTML.
function stableToken() {
  const dir =
    process.env.MAGPIE_ROUTE_COST_CACHE || join(homedir(), ".cache", "magpie", "route-cost");
  const file = join(dir, "token");
  try {
    const saved = readFileSync(file, "utf8").trim();
    if (/^[A-Za-z0-9_-]{16,128}$/.test(saved)) return saved;
  } catch {
    // First start, or an unreadable token: make a new one.
  }
  const fresh = randomBytes(24).toString("base64url");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${fresh}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
  } catch {
    // A read-only cache still leaves a working, if rotating, token.
  }
  return fresh;
}

export async function startServer(options = {}) {
  const port = Number(options.port);
  const requestedPort = Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 3495;
  const retryAttempts =
    Number.isInteger(options.retryAttempts) && options.retryAttempts > 0
      ? options.retryAttempts
      : 16;
  const retryDelayMs =
    Number.isInteger(options.retryDelayMs) && options.retryDelayMs >= 0
      ? options.retryDelayMs
      : 100;
  const token = stableToken();
  const usdCny = Number(options.usdCny) || 6.8;
  const loader = options.load || loadRouteCost;
  let pricingCache = { at: 0, data: null };
  const cache = new Map();
  let boundPort = requestedPort;

  async function pricingData() {
    if (pricingCache.data && Date.now() - pricingCache.at < 60_000) {
      return pricingCache.data;
    }
    const models = await gatewayModels();
    const data = buildPricing(models, { usdCny });
    pricingCache = { at: Date.now(), data };
    return data;
  }

  async function dataFor(period, source = "magpie", opts = {}) {
    const wanted = PERIODS.has(period) ? period : "today";
    const wantedSource = source === "cc" ? "cc" : source === "merged" ? "merged" : "magpie";
    const key = `${wantedSource}|${wanted}`;
    const hit = cache.get(key);
    const now = Date.now();

    // What was read last is shown at once, whatever its age; a new read never
    // stands between the reader and the numbers they had a moment ago.
    if (!opts.fresh && hit?.data) {
      const stale = hit.data.stale === true || now - hit.at >= CACHE_MS;
      if (stale) void refresh(key, wanted, wantedSource, { fresh: true });
      return { data: { ...hit.data, stale }, cache: stale ? "stale" : "fresh" };
    }
    if (hit?.pending) {
      if (hit.data && !opts.fresh) {
        return { data: { ...hit.data, stale: true }, cache: "stale" };
      }
      return { data: await hit.pending, cache: "shared" };
    }
    const loaded = await refresh(key, wanted, wantedSource, { wait: true, fresh: opts.fresh });
    return { data: loaded, cache: loaded?.stale ? "stale" : "miss" };
  }

  function refresh(key, wanted, source, opts = {}) {
    const hit = cache.get(key);
    if (hit?.pending) {
      return opts.wait ? hit.pending : Promise.resolve(hit.data);
    }
    const pending = (async () => {
      if (source === "merged") {
        const magpie = await dataFor(wanted, "magpie", {});
        const cc = await loadCcHistory(wanted, {
          magpieSessions: new Set(magpie.data?.sessionIds || []),
          dbPath: options.ccswitchDb,
        });
        return mergeBooks(wanted, magpie.data, cc, {
          cutoff: magpie.data?.totals?.firstAt || "",
        });
      }
      if (source === "cc") {
        // The overlap that can be proven: CC sessions also present in
        // Magpie's own rows. Magpie gateway rows often carry no session id,
        // so this is a lower bound, stated as such by the page.
        const magpie = await dataFor(wanted, "magpie", {});
        return loadCcHistory(wanted, {
          magpieSessions: new Set(magpie.data?.sessionIds || []),
          dbPath: options.ccswitchDb,
        });
      }
      return loader(wanted, { fresh: Boolean(opts.fresh) });
    })()
      .then((data) => {
        cache.set(key, { at: Date.now(), data, ttl: CACHE_MS });
        return data;
      })
      .catch((error) => {
        if (hit?.data) {
          hit.error = error;
          hit.data = { ...hit.data, stale: true };
          return hit.data;
        }
        throw error;
      })
      .finally(() => {
        const current = cache.get(key);
        if (current?.pending === pending) current.pending = null;
      });
    cache.set(key, { at: hit?.at || 0, data: hit?.data, pending });
    if (!opts.wait) {
      void pending.catch(() => {});
      return Promise.resolve(hit?.data);
    }
    return pending;
  }

  const handler = async (req, res) => {
    try {
      const host = req.headers.host || "";
      if (!allowedHost(host, boundPort)) {
        json(res, 403, { error: "invalid host" });
        return;
      }

      const url = new URL(req.url || "/", `http://${host}`);
      if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
        json(res, 405, { error: "method not allowed" });
        return;
      }

      if (url.pathname === "/healthz") {
        json(res, 200, { ok: true, name: PLUGIN_NAME, version: version(), build: buildId() });
        return;
      }

      if (
        req.method === "OPTIONS" &&
        (url.pathname === "/api/routes" ||
          url.pathname === "/api/routes.csv" ||
          url.pathname === "/api/usage" ||
          url.pathname === "/api/log")
      ) {
        allowNullOrigin(req, res);
        res.writeHead(204, {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end();
        return;
      }

      if (url.pathname === "/") {
        if (!allowedOrigin(req.headers.origin, boundPort)) {
          json(res, 403, { error: "invalid origin" });
          return;
        }
        const template = await readFile(join(UI_DIR, "app.html"), "utf8");
        const lang = String(url.searchParams.get("lang") || "en").slice(0, 12);
        const theme = url.searchParams.get("theme") === "dark" ? "dark" : "light";
        const html = template
          .replaceAll("__ROUTE_COST_TOKEN__", escHTML(token))
          .replaceAll("__ROUTE_COST_THEME__", escHTML(theme))
          .replaceAll("__ROUTE_COST_LANG__", escHTML(lang))
          .replaceAll("__ROUTE_COST_TITLE__", escHTML(lang.toLowerCase().startsWith("zh") ? "用量成本" : "Usage cost"))
          .replaceAll("__ROUTE_COST_TOKENS__", escHTML(JSON.stringify(parseTokens(url.searchParams.get("tokens")))));
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy":
            `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:${boundPort} http://localhost:${boundPort}; base-uri 'none'; form-action 'none'`,
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        });
        res.end(req.method === "HEAD" ? undefined : html);
        return;
      }

      if (url.pathname === "/api/usage") {
        allowNullOrigin(req, res);
        if (!allowedOrigin(req.headers.origin, boundPort)) {
          json(res, 403, { error: "invalid origin" });
          return;
        }
        if (req.headers["x-route-cost-token"] !== token) {
          json(res, 401, { error: "missing or invalid token" });
          return;
        }
        const period = url.searchParams.get("period") || "all";
        if (!PERIODS.has(period)) {
          json(res, 400, { error: "period must be today, 7d, 30d or all" });
          return;
        }
        try {
          const usage = await loadUsage(period, { dbPath: options.ccswitchDb });
          usage.fx = { usdCny, note: `1 USD ≈ ${usdCny} CNY, the rate CC Switch shows` };
          try {
            usage.pricing = await pricingData();
          } catch {
            usage.pricing = null;
          }
          json(res, 200, usage);
        } catch (error) {
          json(res, 500, { error: error?.message || "usage failed" });
        }
        return;
      }

      if (url.pathname === "/api/log") {
        allowNullOrigin(req, res);
        if (!allowedOrigin(req.headers.origin, boundPort)) {
          json(res, 403, { error: "invalid origin" });
          return;
        }
        if (req.headers["x-route-cost-token"] !== token) {
          json(res, 401, { error: "missing or invalid token" });
          return;
        }
        const period = url.searchParams.get("period") || "all";
        if (!PERIODS.has(period)) {
          json(res, 400, { error: "period must be today, 7d, 30d or all" });
          return;
        }
        try {
          const answer = await loadLog(period, {
            agent: url.searchParams.get("agent") || "",
            provider: url.searchParams.get("provider") || "",
            model: url.searchParams.get("model") || "",
            q: url.searchParams.get("q") || "",
            offset: url.searchParams.get("offset") || 0,
            limit: url.searchParams.get("limit") || 100,
          }, { dbPath: options.ccswitchDb });
          answer.fx = { usdCny, note: `1 USD ≈ ${usdCny} CNY` };
          json(res, 200, answer);
        } catch (error) {
          json(res, 500, { error: error?.message || "log failed" });
        }
        return;
      }

      if (url.pathname === "/api/routes" || url.pathname === "/api/routes.csv") {
        allowNullOrigin(req, res);
        if (!allowedOrigin(req.headers.origin, boundPort)) {
          json(res, 403, { error: "invalid origin" });
          return;
        }
        if (req.headers["x-route-cost-token"] !== token) {
          json(res, 401, { error: "missing or invalid token" });
          return;
        }
        const period = url.searchParams.get("period") || "today";
        if (!PERIODS.has(period)) {
          json(res, 400, { error: "period must be today, 7d, 30d or all" });
          return;
        }
        const rawSource = url.searchParams.get("source");
        const source =
          rawSource === "cc" ? "cc" : rawSource === "magpie" ? "magpie" : "merged";
        const loaded = await dataFor(period, source, {
          fresh: url.searchParams.get("fresh") === "1",
        });
        res.setHeader("X-Route-Cost-Cache", loaded.cache);
        if (url.pathname === "/api/routes.csv") {
          const body = toCSV(loaded.data, { usdCny });
          res.writeHead(200, {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${source === "cc" ? "cc-history" : source === "merged" ? "usage-history" : "route-cost"}-${period}.csv"`,
            "Content-Length": Buffer.byteLength(body),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
          res.end(req.method === "HEAD" ? undefined : body);
          return;
        }
        const payload = { ...loaded.data };
        // Session ids are for the CC overlap check, not for the page.
        delete payload.sessionIds;
        payload.fx = { usdCny, note: `1 USD ≈ ${usdCny} CNY, the rate CC Switch shows` };
        try {
          payload.pricing = await pricingData();
        } catch {
          payload.pricing = null;
        }
        json(res, 200, payload);
        return;
      }

      if (url.pathname.startsWith("/icons/")) {
        const name = url.pathname.slice("/icons/".length);
        if (!ICONS.has(name)) {
          json(res, 404, { error: "not found" });
          return;
        }
        const body = await readFile(join(UI_DIR, "icons", name));
        res.writeHead(200, {
          "Content-Type": "image/svg+xml",
          "Content-Length": body.length,
          "Cache-Control": "public, max-age=86400",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(req.method === "HEAD" ? undefined : body);
        return;
      }

      const item = STATIC.get(url.pathname);
      if (item) {
        const body = await readFile(join(UI_DIR, item[0]));
        res.writeHead(200, {
          "Content-Type": item[1],
          "Content-Length": body.length,
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(req.method === "HEAD" ? undefined : body);
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (error) {
      json(res, 500, { error: error?.message || "route cost failed" });
    }
  };

  let server = null;
  const bind = () =>
    new Promise((resolve, reject) => {
      const instance = createServer(handler);
      const onError = (error) => {
        instance.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        instance.off("error", onError);
        resolve(instance);
      };
      instance.once("error", onError);
      instance.once("listening", onListening);
      instance.listen(requestedPort, "127.0.0.1");
    });

  if (requestedPort === 0) {
    server = await bind();
  } else {
    let bound = false;
    for (let attempt = 0; attempt < retryAttempts; attempt += 1) {
      try {
        server = await bind();
        bound = true;
        break;
      } catch (error) {
        if (error?.code !== "EADDRINUSE") throw error;
        const running = await probeService(requestedPort);
        if (running && running.version === version() && running.build === buildId()) {
          return { port: requestedPort, token: "", server: null, reused: true, close: async () => {} };
        }
        if (retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
    }
    if (!bound) {
      const running = await probeService(requestedPort);
      if (running && running.version === version() && running.build === buildId()) {
        return { port: requestedPort, token: "", server: null, reused: true, close: async () => {} };
      }
      throw new Error(
        running
          ? `port ${requestedPort} is held by another build of this plugin (${running.version || "unknown"})`
          : `port ${requestedPort} is in use and not by this plugin`,
      );
    }
  }

  boundPort = server.address().port;
  if (!options.load) {
    void dataFor("today", "merged").catch(() => {});
    void pricingData().catch(() => {});
  }
  return {
    port: boundPort,
    token,
    server,
    close: () =>
      new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          setTimeout(resolve, 25);
        };
        server.close(finish);
        server.closeIdleConnections?.();
        setTimeout(finish, 1500);
      }),
  };
}
