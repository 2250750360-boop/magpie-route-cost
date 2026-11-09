// One row per underlying model. Providers give the same model different ids
// and suffixes; these rules fold those aliases together so Kimi K3.1 Pro is
// one line whether it came from Kimi Code, WorkBuddy, Trae CN or Qoder.

function cap(word) {
  if (!word) return "";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function canonicalModel(name) {
  const raw = String(name || "").trim();
  if (!raw) return "Unknown";
  const s = raw.toLowerCase();

  if (s.startsWith("group/")) {
    const route = s.slice(6);
    if (route.includes("kimi-k31")) return "Kimi K3.1 Pro";
    if (route.includes("ds-v41")) return "DeepSeek V4.1 Flash";
    if (route.includes("qwen-38-max")) return "Qwen3.8 Max";
    if (route.includes("qwen-38-flash")) return "Qwen3.8 Flash";
    if (route.includes("glm-53-flash")) return "GLM-5.3 Flash";
    if (route.includes("glm-53")) return "GLM-5.3";
    if (route.includes("mimo-v26-pro")) return "MiMo V2.6 Pro";
    if (route.startsWith("use-")) return "Mixed route";
    return "Unknown";
  }

  if (s.includes("kimi-k31") || s.includes("kimi-k3.1")) return "Kimi K3.1 Pro";
  if (s.includes("ds-v41")) return "DeepSeek V4.1 Flash";
  if (s.includes("qwen-38-max")) return "Qwen3.8 Max";
  if (s.includes("qwen-38-flash")) return "Qwen3.8 Flash";
  if (s.includes("glm-53-flash")) return "GLM-5.3 Flash";
  if (s.includes("glm-53")) return "GLM-5.3";
  if (s.includes("mimo-v26-pro")) return "MiMo V2.6 Pro";

  if (s.includes("k3.1-pro-highspeed") || s.includes("k3d1-agent-fast")) {
    return "Kimi K3.1 Pro Highspeed";
  }
  if (s.includes("k3.1-pro") || s.includes("k3d1-agent") || s.includes("kmodel_latest")) {
    return "Kimi K3.1 Pro";
  }
  if (s.includes("kimi-for-coding-highspeed") || s.includes("k2.7")) {
    return "Kimi K2.7 Code Highspeed";
  }
  if (s.includes("k2.8") || s.includes("kimi-for-coding")) return "Kimi K2.8";
  if (s.includes("k3-256k")) return "Kimi K3 256K";
  if (s.includes("k3-agent") || /(^|\/)k3($|-)/.test(s)) return "Kimi K3";

  if (s.includes("deepseek-v4.1-flash") || s.includes("deepseek-flash") || s.includes("dfmodel")) {
    return "DeepSeek V4.1 Flash";
  }
  if (s.includes("deepseek-v4-flash")) return "DeepSeek V4 Flash";
  if (s.includes("deepseek-v4-pro")) return "DeepSeek V4 Pro";

  if (s.includes("qwen3.8-flash") || s.includes("qfmodel")) return "Qwen3.8 Flash";
  if (s.includes("qwen3.8-max") || s.includes("qmodel_38max")) return "Qwen3.8 Max";

  if (s.includes("glm-5.3-flashx")) return "GLM-5.3 FlashX";
  if (s.includes("glm-5.3-flash") || s.includes("gfmodel")) return "GLM-5.3 Flash";
  if (s.includes("glm-5.3") || s.includes("gmodel")) return "GLM-5.3";
  if (s.includes("glm-5.2")) return "GLM-5.2";
  if (s.includes("glm-5-turbo")) return "GLM-5 Turbo";

  if (s.includes("mimo-v2.6-flash")) return "MiMo V2.6 Flash";
  if (s.includes("mimo-v2.6-pro")) return "MiMo V2.6 Pro";

  const gpt = s.match(/gpt-([0-9][0-9.]*)(?:-([a-z][a-z0-9]*))?/);
  if (gpt) {
    return `GPT-${gpt[1]}${gpt[2] ? ` ${cap(gpt[2])}` : ""}`;
  }

  if (s.includes("claude-opus-5-5")) return "Claude Opus 5.5";
  if (s.includes("claude")) return `Claude ${cap(s.split("-").pop() || "")}`.trim();

  if (s.includes("doubao") || s.includes("seed")) return "Doubao Seed 2.1 Pro";
  if (s.includes("minimax")) return "MiniMax M3.1 Flash";
  if (s.includes("longcat")) return "LongCat 2.0";
  if (s.includes("hy4") || s.includes("hunyuan")) return "Hunyuan Hy4";

  if (s.includes("qoduck") || s.includes("lmodel")) return "QoDuck";
  if (s.includes("sonus") || s.includes("smodel")) return "Sonus";
  if (s === "default") return "Tabbit Default";
  if (s === "unknown" || s === "?") return "Unknown";

  return raw;
}
