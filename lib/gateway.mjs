// Everything here comes from Magpie's own local gateway. The plugin reads no
// settings file and starts no CLI: the gateway counted every request and
// priced it, and this page only groups what it already knows.

import http from "node:http";
import https from "node:https";

const DEFAULT_GATEWAY = "http://127.0.0.1:3425";

function normalizeGateway(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(text) ? text : "";
}

export function gatewayCandidates(options = {}) {
  const out = [];
  const push = (value) => {
    const text = normalizeGateway(value);
    if (text && !out.includes(text)) out.push(text);
  };
  push(options.gateway);
  push(process.env.MAGPIE_ROUTE_COST_GATEWAY);
  push(process.env.MAGPIE_GATEWAY);
  const addr = process.env.MAGPIE_ADDR;
  if (addr) {
    const loopback = String(addr).replace(/^(0\.0\.0\.0|\[::\]):/, "127.0.0.1:");
    if (/^[\w.-]+:\d+$/.test(loopback)) push(`http://${loopback}`);
  }
  push(DEFAULT_GATEWAY);
  return out;
}

let picked = { at: 0, url: "" };

export function resetGatewayCache() {
  picked = { at: 0, url: "" };
}

function gatewayHeaders() {
  const key = String(process.env.MAGPIE_API_KEY || process.env.MAGPIE_GATEWAY_KEY || "").trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

export async function resolveGateway(options = {}) {
  if (options.gateway) {
    const explicit = normalizeGateway(options.gateway);
    if (!explicit) throw new Error("invalid Magpie gateway URL");
    return explicit;
  }
  if (picked.url && Date.now() - picked.at < 60_000) return picked.url;
  for (const url of gatewayCandidates(options)) {
    try {
      const res = await fetch(`${url}/v1/magpie/usage?period=today`, {
        headers: gatewayHeaders(),
        signal: AbortSignal.timeout(2500),
      });
      if (res.ok) {
        await res.body?.cancel().catch(() => {});
        picked = { at: Date.now(), url };
        return url;
      }
      await res.body?.cancel().catch(() => {});
    } catch {
      // Try the next candidate.
    }
  }
  return gatewayCandidates(options)[0] || DEFAULT_GATEWAY;
}

function getJSON(url, timeout = 20_000) {
  return new Promise((resolve, reject) => {
    let request;
    try {
      const target = new URL(url);
      const client = target.protocol === "https:" ? https : http;
      request = client.get(
        target,
        {
          agent: false,
          headers: {
            ...gatewayHeaders(),
            Accept: "application/json",
            "Accept-Encoding": "identity",
            Connection: "close",
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("error", reject);
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            let body = null;
            try {
              body = JSON.parse(raw);
            } catch {
              // Keep body null so a failed response still reports its HTTP status.
            }
            const status = Number(res.statusCode) || 0;
            if (status < 200 || status >= 300) {
              reject(new Error(body?.error || `Magpie gateway returned HTTP ${status}`));
              return;
            }
            if (!body || typeof body !== "object" || Array.isArray(body)) {
              reject(new Error("Magpie gateway returned an invalid JSON object"));
              return;
            }
            resolve(body);
          });
        },
      );
      request.setTimeout(timeout, () => {
        request.destroy(new Error("Magpie gateway request timed out"));
      });
      request.on("error", reject);
    } catch (error) {
      reject(error);
    }
  });
}

// The requests API returns 500 rows at most per answer, whatever limit asks
// for. 500 keeps every part of a period in a handful of answers.
export const PAGE_SIZE = 500;

export async function gatewayModels(options = {}) {
  const base = await resolveGateway(options);
  return getJSON(`${base}/v1/models`, options.timeout);
}

export async function gatewayRequestsPage(period, offset, options = {}) {
  const base = await resolveGateway(options);
  const query = new URLSearchParams();
  query.set("period", period);
  query.set("limit", String(PAGE_SIZE));
  query.set("offset", String(offset));
  return getJSON(`${base}/v1/magpie/usage/requests?${query.toString()}`, options.timeout);
}
