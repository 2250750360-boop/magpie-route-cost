const SYSTEM = new Set(["curl", "node", "session", "magpie"]);

export function agentKey(name) {
  const a = String(name || "").toLowerCase();
  if (a.includes("kimi")) return "kimi-code";
  if (a.includes("codex")) return "codex";
  if (a.includes("dsh")) return "dsh";
  if (a.includes("claude")) return "claude";
  if (a.includes("qoder") && a.includes("cn")) return "qoder-cn";
  if (a.includes("qoder")) return "qoder";
  if (a.includes("mcode")) return "mcode";
  if (a.includes("magpie")) return "magpie";
  if (a.includes("curl")) return "curl";
  if (a.includes("node")) return "node";
  if (a.includes("session")) return "session";
  return a || "unknown";
}

export function isSystemAgent(key) {
  return SYSTEM.has(key);
}

export const AGENT_LABELS = {
  "kimi-code": "Kimi Code",
  codex: "Codex",
  dsh: "DSH",
  claude: "Claude",
  qoder: "Qoder",
  "qoder-cn": "Qoder CN",
  mcode: "MCode",
  magpie: "Magpie",
  curl: "curl",
  node: "node",
  session: "Session",
  unknown: "Unknown",
};

export const PROVIDER_LABELS = {
  codex: "Codex",
  workbuddy: "WorkBuddy",
  "trae-cn": "Trae CN",
  "qoder-cn": "Qoder CN",
  qoder: "Qoder",
  kimi: "Kimi Code",
  "kimi-work": "Kimi Work",
  tabbit: "Tabbit",
  zcode: "ZCode",
  _kimi_session: "Kimi Code (history)",
  _codex_session: "Codex (history)",
  _dsh_session: "DSH (history)",
  _dsh_account_session: "DSH (history)",
  _mcode_session: "MCode (history)",
  _session: "Session history",
};

export function agentLabel(key) {
  return AGENT_LABELS[key] || key || "—";
}

export function providerLabel(id) {
  return PROVIDER_LABELS[id] || id || "—";
}
