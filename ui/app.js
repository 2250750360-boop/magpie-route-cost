(() => {
  const meta = (name) =>
    document.querySelector(`meta[name="route-cost-${name}"]`)?.getAttribute("content") || "";
  const token = meta("token");
  const lang = meta("lang").toLowerCase().startsWith("zh") ? "zh" : "en";
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

  const words = {
    en: {
      title: "Usage cost",
      subtitle: "One line per model, with every agent and provider behind it.",
      today: "Today", "7d": "7 days", "30d": "30 days", all: "All",
      refresh: "Refresh", export: "Export CSV",
      search: "Filter models, agents or providers", expandAll: "Expand all",
      minTokens: "Min tokens",
      tabModels: "Models", tabProviders: "Providers", tabLog: "Request log",
      colTime: "Time", colModel: "Model", colProvider: "Provider", colAgent: "Agent",
      colRoute: "Route", colCalls: "Requests", colCost: "Cost", colTokens: "Tokens",
      colSuccess: "Success", colSpeed: "Speed", colTtft: "First token", colShare: "Share",
      cost: "Total cost", requests: "Requests", tokens: "Tokens", cache: "Cache hit",
      official: "official list price", successSub: (n) => `${n} successful`,
      tokensSub: "input + output + cache", cacheSub: "cache reads / input",
      heatTitle: "Usage heatmap", heatSub: "Daily tokens across the whole history",
      less: "Less", more: "More", wd: ["M", "W", "F"],
      unpriced: "unpriced", perMillion: "per 1M tokens",
      allAgents: "All agents", allProviders: "All providers", allModels: "All models",
      system: "System", emptyTitle: "No usage in this period",
      emptyText: "Run an agent through Magpie or CC Switch, then refresh.",
      errorTitle: "Could not read usage", retry: "Retry", loading: "Reading usage...",
      updated: "Updated", cached: "cached",
      pricing: "Official list price equivalent, not cash spend.",
      footNote: (n, ok) => `${n} requests · ${ok}% success · official price equivalent`,
      prev: "Prev", next: "Next",
      page: (from, to, total) => `${from}–${to} of ${total}`,
      countModels: (n) => `${n} models`,
      countProviders: (n) => `${n} providers`,
      countLog: (n) => `${n} requests`,
      tokenMissing: "The page is missing its service token. Reopen it from Magpie.",
      noRows: "No requests",
    },
    zh: {
      title: "用量成本",
      subtitle: "一个模型一行，展开就是不同 Agent 在不同 Provider 的用量。",
      today: "今天", "7d": "7 天", "30d": "30 天", all: "全部",
      refresh: "刷新", export: "导出 CSV",
      search: "筛选模型、Agent 或 Provider", expandAll: "展开全部",
      minTokens: "最少 Tokens",
      tabModels: "模型", tabProviders: "供应商", tabLog: "请求日志",
      colTime: "时间", colModel: "模型", colProvider: "Provider", colAgent: "Agent",
      colRoute: "路由", colCalls: "请求数", colCost: "成本", colTokens: "Tokens",
      colSuccess: "成功率", colSpeed: "速度", colTtft: "首字", colShare: "占比",
      cost: "总成本", requests: "总请求数", tokens: "Tokens", cache: "缓存命中率",
      official: "官方价等价", successSub: (n) => `${n} 次成功`,
      tokensSub: "输入 + 输出 + 缓存", cacheSub: "缓存读 / 总输入",
      heatTitle: "用量热力图", heatSub: "整段历史的每日 Tokens",
      less: "少", more: "多", wd: ["一", "三", "五"],
      unpriced: "未定价", perMillion: "每百万 tokens",
      allAgents: "全部 Agent", allProviders: "全部 Provider", allModels: "全部模型",
      system: "系统", emptyTitle: "这个时间段没有用量",
      emptyText: "让 Agent 通过 Magpie 或 CC Switch 跑一次，然后刷新。",
      errorTitle: "读取用量失败", retry: "重试", loading: "正在读取用量...",
      updated: "更新于", cached: "缓存",
      pricing: "官方 API 等价，不是现金支出。",
      footNote: (n, ok) => `共 ${n} 条请求 · 成功率 ${ok}% · 官方价等价`,
      prev: "上一页", next: "下一页",
      page: (from, to, total) => `${from}–${to} / ${total}`,
      countModels: (n) => `${n} 个模型`,
      countProviders: (n) => `${n} 个供应商`,
      countLog: (n) => `${n} 条请求`,
      tokenMissing: "页面缺少服务令牌，请从 Magpie 重新打开。",
      noRows: "没有请求",
    },
  };
  const W = words[lang];

  const state = {
    period: "all", currency: "usd", tab: "models", minTokens: 1_000_000,
    data: null, log: { rows: [], total: 0, offset: 0, limit: 100, loading: false },
    loading: true, error: "", query: "",
    filters: { agent: "", provider: "", model: "" },
    expanded: new Set(), expandAll: false, loadedAt: 0, animate: true,
  };

  const store = (() => {
    const memory = new Map();
    return {
      get(key) { try { return localStorage.getItem(key); } catch { return memory.get(key) ?? null; } },
      set(key, value) { try { localStorage.setItem(key, value); } catch { memory.set(key, value); } },
    };
  })();

  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function applyTheme() {
    document.documentElement.dataset.theme = meta("theme") === "dark" ? "dark" : "light";
    try {
      const tokens = JSON.parse(meta("tokens") || "{}");
      for (const [key, value] of Object.entries(tokens)) {
        if (typeof value === "string") document.documentElement.style.setProperty(`--magpie-${key}`, value);
      }
    } catch {}
  }

  function rate() { return Number(state.data?.fx?.usdCny) || 6.8; }
  function symbol() { return state.currency === "cny" ? "¥" : "$"; }

  function money(value) {
    const v = Number(value) || 0;
    const amount = state.currency === "cny" ? v * rate() : v;
    if (amount === 0) return `${symbol()}0`;
    if (amount < 0.01) return `${symbol()}${amount.toFixed(4)}`;
    if (amount < 1) return `${symbol()}${amount.toFixed(3)}`;
    return `${symbol()}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function priceValue(value) {
    const v = Number(value) || 0;
    const amount = state.currency === "cny" ? v * rate() : v;
    if (v === 0) return `${symbol()}0`;
    if (amount < 0.01) return `${symbol()}${amount.toFixed(4)}`;
    if (amount < 1) return `${symbol()}${amount.toFixed(3)}`;
    return `${symbol()}${amount.toFixed(2)}`;
  }

  function priceText(entry) {
    if (!entry || !entry.priced) return W.unpriced;
    if (Number(entry.usd.input) === 0 && Number(entry.usd.output) === 0) return W.unpriced;
    return `${priceValue(entry.usd.input)}/${priceValue(entry.usd.output)} ${W.perMillion}`;
  }

  const count = (value) => (Number(value) || 0).toLocaleString();
  const compact = (value) => {
    const v = Number(value) || 0;
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return String(Math.round(v));
  };
  const percent = (value, digits = 1) => {
    const v = (Number(value) || 0) * 100;
    if (v > 0 && v < 0.1) return "<0.1%";
    return `${v.toFixed(digits)}%`;
  };
  const success = (ok, calls) => (calls ? `${((ok / calls) * 100).toFixed(1)}%` : "—");
  const successClass = (ok, calls) => {
    if (!calls) return "";
    const v = (ok / calls) * 100;
    return v >= 95 ? "high" : v < 80 ? "low" : "";
  };
  const speedText = (v) => {
    const n = Number(v) || 0;
    return n > 0 && n <= 500 ? `${Math.round(n)}` : "—";
  };
  const ttftText = (v) => (Number(v) > 0 ? `${(Number(v) / 1000).toFixed(2)}s` : "—");
  const timeText = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(lang === "zh" ? "zh-CN" : "en", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  };

  function animateNumber(node, target, format, duration = 650) {
    const value = Number(target) || 0;
    if (reduceMotion || !Number.isFinite(value)) { node.textContent = format(value); return; }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = format(value * eased);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function applyLanguage() {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = W.title;
    $("title").textContent = W.title;
    $("subtitle").textContent = W.subtitle;
    $("refresh").textContent = W.refresh;
    $("export").textContent = W.export;
    $("search").placeholder = W.search;
    $("expand-label").textContent = W.expandAll;
    $("min-label").textContent = W.minTokens;
    $("min-tokens").value = String(state.minTokens);
    $("heat-title").textContent = W.heatTitle;
    $("heat-sub").textContent = W.heatSub;
    $("legend-less").textContent = W.less;
    $("legend-more").textContent = W.more;
    $("wd1").textContent = W.wd[0];
    $("wd2").textContent = W.wd[1];
    $("wd3").textContent = W.wd[2];
    $("tab-models").textContent = W.tabModels;
    $("tab-providers").textContent = W.tabProviders;
    $("tab-log").textContent = W.tabLog;
    $("pricing-note").textContent = W.pricing;
    $("prev-page").textContent = W.prev;
    $("next-page").textContent = W.next;
    for (const b of $("periods").querySelectorAll("button")) b.textContent = W[b.dataset.period];
  }

  function renderPeriods() {
    for (const b of $("periods").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.period === state.period));
    for (const b of $("currency").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.currency === state.currency));
    for (const b of $("tabs").querySelectorAll("button")) b.setAttribute("aria-selected", String(b.dataset.tab === state.tab));
  }

  function metric(label, target, format, sub) {
    const node = el("div", "metric");
    const value = el("div", "value", "");
    animateNumber(value, target, format);
    node.append(el("div", "label", label), value, el("div", "sub", sub));
    return node;
  }

  function cacheHit(t) {
    const reads = Number(t.cacheRead) || 0;
    const base = (Number(t.input) || 0) + (Number(t.cacheWrite) || 0) + reads;
    return base > 0 ? reads / base : 0;
  }

  function filteredMembers(models) {
    const out = [];
    for (const model of models) for (const member of model.members) out.push(member);
    return out;
  }

  function sumMembers(members) {
    const t = { calls: 0, ok: 0, cost: 0, allTokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, unpriced: 0 };
    for (const m of members) {
      t.calls += m.calls; t.ok += m.ok; t.cost += m.cost; t.allTokens += m.allTokens;
      t.input += m.input; t.output += m.output; t.cacheRead += m.cacheRead; t.cacheWrite += m.cacheWrite;
    }
    return t;
  }

  function weighted(members, field) {
    let total = 0;
    let calls = 0;
    for (const member of members) {
      if (Number(member[field]) > 0) {
        total += Number(member[field]) * member.calls;
        calls += member.calls;
      }
    }
    return calls ? total / calls : 0;
  }

  function currentTotals() { return sumMembers(filteredMembers(buildModels())); }

  function renderMetrics() {
    const host = $("metrics");
    host.replaceChildren();
    if (!state.data) return;
    const t = currentTotals();
    host.append(
      metric(W.cost, t.cost, money, W.official),
      metric(W.requests, t.calls, count, W.successSub(count(t.ok))),
      metric(W.tokens, t.allTokens, compact, W.tokensSub),
      metric(W.cache, cacheHit(t), (v) => percent(v), W.cacheSub),
    );
  }

  function heatLevel(tokens, thresholds) {
    if (!tokens) return 0;
    if (tokens <= thresholds[0]) return 1;
    if (tokens <= thresholds[1]) return 2;
    if (tokens <= thresholds[2]) return 3;
    return 4;
  }

  function renderHeatmap() {
    const grid = $("heat-grid"), months = $("heat-months");
    grid.replaceChildren(); months.replaceChildren();
    if (!state.data) return;
    const daily = new Map((state.data.daily || []).map((c) => [c.date, c]));
    const values = [...daily.values()].map((c) => c.tokens).filter(Boolean).sort((a, b) => a - b);
    const pick = (q) => (values.length ? values[Math.min(values.length - 1, Math.floor(values.length * q))] : 0);
    const thresholds = [pick(.25), pick(.5), pick(.75)];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(today); start.setDate(start.getDate() - 364); start.setDate(start.getDate() - start.getDay());
    const weeks = Math.ceil((Math.floor((today - start) / 86400000) + 1) / 7);
    const gap = 4;
    const scroller = grid.closest(".heat-scroll");
    const available = Math.max(320, (scroller?.clientWidth || 900) - 36 - 23 - 6);
    const cell = Math.max(8, Math.min(22, Math.floor((available - (weeks - 1) * gap) / weeks)));
    for (const node of [grid, months]) {
      node.style.setProperty("--weeks", String(weeks));
      node.style.setProperty("--cell", `${cell}px`);
    }
    let lastMonth = -1;
    for (let week = 0; week < weeks; week += 1) {
      const ws = new Date(start); ws.setDate(ws.getDate() + week * 7);
      const month = ws.getMonth();
      months.append(el("span", "", month !== lastMonth ? ws.toLocaleDateString(lang === "zh" ? "zh-CN" : "en", { month: "short" }) : ""));
      lastMonth = month;
      for (let wd = 0; wd < 7; wd += 1) {
        const date = new Date(ws); date.setDate(date.getDate() + wd);
        if (date > today) { grid.append(el("i", "heat-cell empty")); continue; }
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        const c = daily.get(key);
        const level = heatLevel(c?.tokens || 0, thresholds);
        const node = el("i", `heat-cell${level ? ` l${level}` : ""}`);
        node.style.setProperty("--w", String(week));
        node.title = c ? `${key} · ${money(c.cost)} · ${compact(c.tokens)} tokens · ${count(c.calls)} req` : key;
        grid.append(node);
      }
    }
  }

  const AGENT_ICONS = { "kimi-code": "kimi.svg", codex: "openai.svg", dsh: "deepseek.svg", claude: "claude.svg", qoder: "qoder.svg", "qoder-cn": "qoder.svg", mcode: "minimax.svg" };
  const PROVIDER_ICONS = { workbuddy: "workbuddy-color.svg", "trae-cn": "trae.svg", qoder: "qoder.svg", "qoder-cn": "qoder.svg", kimi: "kimi.svg", "kimi-work": "kimi.svg", codex: "openai.svg", zcode: "zhipu.svg", _kimi_session: "kimi.svg", _codex_session: "openai.svg", _dsh_session: "deepseek.svg", _dsh_account_session: "deepseek.svg", _mcode_session: "minimax.svg" };

  function modelIcon(name) {
    const s = String(name || "").toLowerCase();
    if (s.includes("kimi")) return "kimi.svg";
    if (s.includes("deepseek")) return "deepseek.svg";
    if (s.includes("qwen")) return "qwen.svg";
    if (s.includes("glm")) return "zhipu.svg";
    if (s.includes("gpt")) return "openai.svg";
    if (s.includes("claude")) return "claude.svg";
    if (s.includes("mimo")) return "xiaomimimo.svg";
    if (s.includes("doubao")) return "doubao.svg";
    if (s.includes("longcat")) return "longcat-color.svg";
    if (s.includes("hunyuan")) return "hunyuan.svg";
    if (s.includes("minimax")) return "minimax.svg";
    if (s.includes("qoduck")) return "alibaba.svg";
    return "";
  }

  function iconEl(file, cls) {
    if (!file) return null;
    const img = document.createElement("img");
    img.className = cls; img.src = `/icons/${file}`; img.alt = ""; img.loading = "lazy";
    return img;
  }

  function collectFilters(data) {
    const agents = new Map(), providers = new Map(), models = new Map();
    const realProviders = new Set();
    for (const model of data.models || []) {
      for (const member of model.members || []) {
        if (member.agent !== "system") {
          agents.set(member.agent, { label: member.agentLabel, icon: AGENT_ICONS[member.agent] || "" });
          realProviders.add(member.provider);
        }
        providers.set(member.provider, { label: member.providerLabel, icon: PROVIDER_ICONS[member.provider] || "" });
        if (model.name !== "Unknown" && model.name !== "Mixed route" && model.allTokens >= state.minTokens) {
          models.set(model.name, { label: model.name, icon: modelIcon(model.name) });
        }
      }
    }
    for (const key of [...providers.keys()]) {
      if (!realProviders.has(key)) providers.delete(key);
    }
    return { agents, providers, models };
  }

  function closeMenus() {
    for (const host of document.querySelectorAll(".filter")) {
      host.querySelector(".filter-menu").hidden = true;
      host.querySelector(".filter-btn").setAttribute("aria-expanded", "false");
    }
  }

  function renderMenu(id, key, allLabel, items, selected) {
    const host = $(id);
    const icon = host.querySelector(".filter-icon");
    const label = host.querySelector(".filter-label");
    const menu = host.querySelector(".filter-menu");
    const current = selected ? items.get(selected) : null;
    label.textContent = current?.label || allLabel;
    if (current?.icon) { icon.src = `/icons/${current.icon}`; icon.hidden = false; }
    else { icon.hidden = true; icon.removeAttribute("src"); }
    menu.replaceChildren();
    const make = (value, text, iconFile) => {
      const item = el("button", "filter-item");
      item.type = "button"; item.setAttribute("role", "option");
      if (value === selected) item.classList.add("selected");
      const img = iconEl(iconFile, "filter-icon"); if (img) item.append(img);
      item.append(el("span", "", text));
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        state.filters[key] = value;
        state.expanded.clear();
        state.log.offset = 0;
        closeMenus();
        renderFilters();
        renderMetrics();
        if (state.tab === "log") loadLog(); else renderTable();
        renderFoot();
      });
      return item;
    };
    menu.append(make("", allLabel, ""));
    for (const [value, info] of [...items.entries()].sort((a, b) => String(a[1].label).localeCompare(String(b[1].label)))) {
      menu.append(make(value, info.label, info.icon));
    }
  }

  function renderFilters() {
    if (!state.data) return;
    const { agents, providers, models } = collectFilters(state.data);
    renderMenu("filter-agent", "agent", W.allAgents, agents, state.filters.agent);
    renderMenu("filter-provider", "provider", W.allProviders, providers, state.filters.provider);
    renderMenu("filter-model", "model", W.allModels, models, state.filters.model);
  }

  function priceMap() {
    const map = new Map();
    for (const entry of state.data?.pricing?.models || []) {
      const key = entry.canonical || entry.model || entry.name;
      const list = map.get(key) || [];
      list.push(entry);
      map.set(key, list);
    }
    return map;
  }

  function buildModels() {
    const filters = state.filters;
    const prices = priceMap();
    const out = [];
    for (const model of state.data?.models || []) {
      if (model.name === "Unknown" || model.name === "Mixed route") continue;
      if ((model.allTokens || 0) < state.minTokens) continue;
      if (filters.model && model.name !== filters.model) continue;
      const members = model.members.filter((member) => {
        if (filters.agent && member.agent !== filters.agent) return false;
        if (filters.provider && member.provider !== filters.provider) return false;
        return true;
      });
      if (!members.length) continue;
      const t = sumMembers(members);
      const entries = prices.get(model.name) || [];
      out.push({
        key: model.name, name: model.name, members,
        calls: t.calls, ok: t.ok, cost: t.cost, allTokens: t.allTokens,
        input: t.input, output: t.output, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite,
        speed: weighted(members, "speed"), ttft: weighted(members, "ttft"),
        prices: entries,
        priced: entries.some((p) => p.priced && (Number(p.usd?.input) > 0 || Number(p.usd?.output) > 0)),
        share: 0,
      });
    }
    const total = out.reduce((s, r) => s + r.cost, 0);
    for (const row of out) row.share = total > 0 ? row.cost / total : 0;
    out.sort((a, b) => b.cost - a.cost || b.calls - a.calls || a.name.localeCompare(b.name));
    return out;
  }

  function buildProviders() {
    const filters = state.filters;
    const out = [];
    for (const provider of state.data?.providers || []) {
      if ((provider.allTokens || 0) < state.minTokens) continue;
      if (filters.provider && provider.provider !== filters.provider) continue;
      const members = provider.members.filter((member) => {
        if (filters.agent && member.agent !== filters.agent) return false;
        if (filters.model && member.canonical !== filters.model) return false;
        return true;
      });
      if (!members.length) continue;
      if (members.every((member) => member.agent === "system")) continue;
      const t = sumMembers(members);
      out.push({
        key: provider.provider, provider: provider.provider, label: provider.label,
        members, calls: t.calls, ok: t.ok, cost: t.cost, allTokens: t.allTokens,
        speed: weighted(members, "speed"), ttft: weighted(members, "ttft"), share: 0,
      });
    }
    const total = out.reduce((s, r) => s + r.cost, 0);
    for (const row of out) row.share = total > 0 ? row.cost / total : 0;
    out.sort((a, b) => b.cost - a.cost || b.calls - a.calls);
    return out;
  }

  function memberPrice(member, model) {
    return (model.prices || []).find((p) => p.provider === member.provider && p.model === member.model) || null;
  }

  function matchesModel(model, query) {
    if (!query) return true;
    if (model.name.toLowerCase().includes(query)) return true;
    return model.members.some((m) =>
      (m.model || "").toLowerCase().includes(query) ||
      (m.agentLabel || "").toLowerCase().includes(query) ||
      (m.providerLabel || "").toLowerCase().includes(query));
  }

  function matchesProvider(provider, query) {
    if (!query) return true;
    if (String(provider.label || "").toLowerCase().includes(query)) return true;
    return provider.members.some((m) =>
      (m.model || "").toLowerCase().includes(query) ||
      (m.agentLabel || "").toLowerCase().includes(query));
  }

  function headersFor(tab) {
    if (tab === "providers") return ["", W.colProvider, W.colCalls, W.colCost, W.colTokens, W.colSuccess, W.colSpeed, W.colTtft, W.colShare];
    if (tab === "log") return [W.colTime, W.colAgent, W.colProvider, W.colModel, W.colRoute, W.colCost, W.colTokens, W.colSuccess, W.colSpeed, W.colTtft];
    return ["", W.colModel, W.colCalls, W.colCost, W.colTokens, W.colSuccess, W.colSpeed, W.colTtft];
  }

  function renderHeader(tab) {
    const columns = $("columns");
    columns.replaceChildren();
    for (const text of headersFor(tab)) columns.append(el("span", "", text));
  }

  function shareCell(share) {
    const node = el("span", "share");
    const bar = el("span", "bar");
    const fill = el("i");
    const width = `${Math.min(100, Math.max(0, share * 100))}%`;
    fill.style.width = reduceMotion ? width : "0%";
    bar.append(fill); node.append(bar, el("span", "pct", percent(share)));
    if (!reduceMotion) requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = width; }));
    return node;
  }

  function modelRow(model) {
    const open = state.expanded.has(model.key);
    const row = el("button", "route model-row");
    row.type = "button"; row.setAttribute("aria-expanded", String(open));
    const name = el("span", "name");
    const icon = iconEl(modelIcon(model.name), "m-icon"); if (icon) name.append(icon);
    name.append(document.createTextNode(model.name));
    row.append(
      el("span", "chev", "›"), name,
      el("span", "num", count(model.calls)),
      el("span", "num cost", money(model.cost)),
      el("span", "num", compact(model.allTokens)),
      el("span", `num success ${successClass(model.ok, model.calls)}`, success(model.ok, model.calls)),
      el("span", "num", speedText(model.speed)),
      el("span", "num", ttftText(model.ttft)),
    );
    row.addEventListener("click", () => {
      if (state.expanded.has(model.key)) state.expanded.delete(model.key); else state.expanded.add(model.key);
      renderTable();
    });
    return row;
  }

  function modelMemberRow(member, model) {
    const row = el("div", "member model-member");
    const who = el("div", "who");
    const pimg = iconEl(PROVIDER_ICONS[member.provider], "p-icon"); if (pimg) who.append(pimg);
    who.append(el("span", "provider", member.providerLabel), el("span", "model", member.model));
    const entry = memberPrice(member, model);
    if (entry) who.append(el("span", "member-price", priceText(entry)));
    const routes = entry?.routes || [];
    if (routes.length) who.append(el("span", "member-routes", routes.map((r) => r.replace(/^group\//, "")).slice(0, 3).join(" · ")));
    row.append(
      el("span", "agent", member.agentLabel || W.system), who,
      el("span", "num", count(member.calls)),
      el("span", "num cost", money(member.cost)),
      el("span", "num", compact(member.allTokens)),
      el("span", `num success ${successClass(member.ok, member.calls)}`, success(member.ok, member.calls)),
      el("span", "num", speedText(member.speed)),
      el("span", "num", ttftText(member.ttft)),
    );
    return row;
  }

  function providerRow(provider) {
    const open = state.expanded.has(provider.key);
    const row = el("button", "route provider-row");
    row.type = "button"; row.setAttribute("aria-expanded", String(open));
    const name = el("span", "name");
    const icon = iconEl(PROVIDER_ICONS[provider.provider], "m-icon"); if (icon) name.append(icon);
    name.append(document.createTextNode(provider.label));
    row.append(
      el("span", "chev", "›"), name,
      el("span", "num", count(provider.calls)),
      el("span", "num cost", money(provider.cost)),
      el("span", "num", compact(provider.allTokens)),
      el("span", `num success ${successClass(provider.ok, provider.calls)}`, success(provider.ok, provider.calls)),
      el("span", "num", speedText(provider.speed)),
      el("span", "num", ttftText(provider.ttft)),
      shareCell(provider.share),
    );
    row.addEventListener("click", () => {
      if (state.expanded.has(provider.key)) state.expanded.delete(provider.key); else state.expanded.add(provider.key);
      renderTable();
    });
    return row;
  }

  function providerMemberRow(member) {
    const row = el("div", "member provider-member");
    row.append(
      el("span", "agent", member.agentLabel || W.system),
      el("span", "model", member.model),
      el("span", "num", count(member.calls)),
      el("span", "num cost", money(member.cost)),
      el("span", "num", compact(member.allTokens)),
      el("span", `num success ${successClass(member.ok, member.calls)}`, success(member.ok, member.calls)),
      el("span", "num", speedText(member.speed)),
      el("span", "num", ttftText(member.ttft)),
    );
    return row;
  }

  function logRow(row) {
    const node = el("div", "log-row");
    node.append(
      el("span", "time", timeText(row.time)),
      el("span", "agent", row.agent === "system" ? W.system : row.agentLabel),
      el("span", "muted", row.providerLabel),
      el("span", "model", row.model),
      el("span", "muted route", row.route),
      el("span", "num cost", money(row.cost)),
      el("span", "num", compact(row.tokens)),
      el("span", `num success ${row.ok ? "high" : "low"}`, row.ok ? "100%" : "0%"),
      el("span", "num", speedText(row.speed)),
      el("span", "num", ttftText(row.ttft)),
    );
    return node;
  }

  function emptyBox() {
    const box = el("div", "empty");
    box.append(el("b", "", W.emptyTitle), el("div", "", W.emptyText));
    return box;
  }

  function renderTable() {
    const animate = state.animate;
    state.animate = false;
    const list = $("list");
    list.replaceChildren();
    $("columns").hidden = false;
    $("pager").hidden = state.tab !== "log";
    const card = document.querySelector(".table-card");
    if (card) card.dataset.tab = state.tab;
    renderHeader(state.tab);

    if (state.loading && !state.data) { list.append(el("div", "loading", W.loading)); return; }
    if (state.error) {
      const box = el("div", "empty");
      box.append(el("b", "", W.errorTitle), el("div", "", state.error));
      const retry = el("button", "btn", W.retry); retry.type = "button"; retry.addEventListener("click", () => load({ fresh: true }));
      box.append(retry); list.append(box); return;
    }
    if (!state.data) return;

    const query = state.query.trim().toLowerCase();
    if (state.tab === "log") {
      if (state.log.loading) { list.append(el("div", "loading", W.loading)); return; }
      if (!state.log.rows.length) { list.append(emptyBox()); return; }
      const frag = document.createDocumentFragment();
      state.log.rows.forEach((row, i) => {
        const node = logRow(row);
        node.style.setProperty("--i", String(Math.min(i, 30)));
        if (animate) node.classList.add("anim");
        frag.append(node);
      });
      list.append(frag);
      $("table-count").textContent = W.countLog(state.log.total);
      return;
    }

    if (state.tab === "providers") {
      const rows = buildProviders().filter((p) => matchesProvider(p, query));
      $("table-count").textContent = W.countProviders(rows.length);
      if (!rows.length) { list.append(emptyBox()); return; }
      const frag = document.createDocumentFragment();
      rows.forEach((p, i) => {
        const node = providerRow(p);
        node.style.setProperty("--i", String(Math.min(i, 30)));
        if (animate) node.classList.add("anim");
        frag.append(node);
        if (state.expanded.has(p.key)) {
          const members = el("div", "members provider-members");
          p.members.forEach((m, j) => {
            const line = providerMemberRow(m);
            line.style.setProperty("--i", String(Math.min(j, 20)));
            members.append(line);
          });
          frag.append(members);
        }
      });
      list.append(frag);
      return;
    }

    const models = buildModels().filter((m) => matchesModel(m, query));
    $("table-count").textContent = W.countModels(models.length);
    if (!models.length) { list.append(emptyBox()); return; }
    const frag = document.createDocumentFragment();
    models.forEach((model, i) => {
      const node = modelRow(model);
      node.style.setProperty("--i", String(Math.min(i, 30)));
      if (animate) node.classList.add("anim");
      frag.append(node);
      if (state.expanded.has(model.key)) {
        const members = el("div", "members model-members");
        model.members.forEach((m, j) => {
          const line = modelMemberRow(m, model);
          line.style.setProperty("--i", String(Math.min(j, 20)));
          members.append(line);
        });
        frag.append(members);
      }
    });
    list.append(frag);
  }

  function renderCounts() {
    if (!state.data) return;
    $("tab-models-n").textContent = String(
      (state.data.models || []).filter(
        (m) => m.name !== "Unknown" && m.name !== "Mixed route" && (m.allTokens || 0) >= state.minTokens,
      ).length,
    );
    $("tab-providers-n").textContent = String(
      (state.data.providers || []).filter(
        (p) => (p.allTokens || 0) >= state.minTokens && p.members.some((m) => m.agent !== "system"),
      ).length,
    );
    $("tab-log-n").textContent = String(state.log.total || state.data.logTotal || 0);
  }

  function renderFoot() {
    $("pricing-note").textContent = W.pricing;
    if (!state.data) { $("foot-note").textContent = ""; $("updated").textContent = ""; return; }
    const t = currentTotals();
    const rateOk = t.calls ? ((t.ok / t.calls) * 100).toFixed(1) : "0.0";
    $("foot-note").textContent = W.footNote(count(t.calls), rateOk);
    const when = new Date(state.data.generatedAt);
    const clock = Number.isNaN(when.getTime()) ? "" : when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    $("updated").textContent = `${W.updated} ${clock}${state.data.stale ? ` (${W.cached})` : ""}`;
    if (state.tab === "log") {
      const from = state.log.offset + 1;
      const to = Math.min(state.log.offset + state.log.limit, state.log.total);
      $("page-info").textContent = state.log.total ? W.page(from, to, state.log.total) : "";
      $("prev-page").disabled = state.log.offset <= 0;
      $("next-page").disabled = state.log.offset + state.log.limit >= state.log.total;
    }
  }

  function render() {
    renderPeriods();
    renderFilters();
    renderCounts();
    renderMetrics();
    renderHeatmap();
    renderTable();
    renderFoot();
  }

  async function load(opts = {}) {
    if (!token) { state.loading = false; state.error = W.tokenMissing; renderTable(); return; }
    state.loading = true; state.error = "";
    renderTable();
    const q = new URLSearchParams({ period: state.period });
    if (opts.fresh) q.set("fresh", "1");
    try {
      const res = await fetch(`/api/usage?${q}`, { headers: { "x-route-cost-token": token }, cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      state.data = body;
      state.loading = false;
      state.loadedAt = Date.now();
      state.animate = true;
      if (state.tab === "log") await loadLog();
      render();
    } catch (error) {
      state.loading = false; state.error = error?.message || String(error); renderTable();
    }
  }

  async function loadLog() {
    if (!token) return;
    state.log.loading = true;
    renderTable();
    const q = new URLSearchParams({
      period: state.period,
      agent: state.filters.agent,
      provider: state.filters.provider,
      model: state.filters.model,
      q: state.query.trim(),
      offset: String(state.log.offset),
      limit: String(state.log.limit),
    });
    try {
      const res = await fetch(`/api/log?${q}`, { headers: { "x-route-cost-token": token }, cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      state.log = { ...state.log, rows: body.rows || [], total: body.total || 0, loading: false };
      renderTable(); renderCounts(); renderFoot();
    } catch (error) {
      state.log = { ...state.log, rows: [], loading: false };
      state.error = error?.message || String(error);
      renderTable();
    }
  }

  function exportCsv() {
    const rows = [];
    const head = ["tab", "name", "agent", "provider", "model", "requests", "cost_usd", "cost_cny", "tokens", "success", "speed_tok_s", "ttft_ms"];
    if (state.tab === "providers") {
      for (const provider of buildProviders()) for (const m of provider.members) {
        rows.push([state.tab, provider.label, m.agentLabel, provider.label, m.model, m.calls, m.cost.toFixed(6), (m.cost * rate()).toFixed(4), m.allTokens, success(m.ok, m.calls), Math.round(m.speed), Math.round(m.ttft)]);
      }
    } else if (state.tab === "log") {
      for (const r of state.log.rows) {
        rows.push([state.tab, r.canonical, r.agentLabel, r.providerLabel, r.model, 1, r.cost.toFixed(6), (r.cost * rate()).toFixed(4), r.tokens, r.ok ? "100%" : "0%", Math.round(r.speed), Math.round(r.ttft)]);
      }
    } else {
      for (const model of buildModels()) for (const m of model.members) {
        rows.push([state.tab, model.name, m.agentLabel, m.providerLabel, m.model, m.calls, m.cost.toFixed(6), (m.cost * rate()).toFixed(4), m.allTokens, success(m.ok, m.calls), Math.round(m.speed), Math.round(m.ttft)]);
      }
    }
    const cell = (v) => {
      const t = String(v);
      return t.includes('"') || t.includes(",") || t.includes(String.fromCharCode(10)) || t.includes(String.fromCharCode(13))
        ? `"${t.replaceAll('"', '""')}"` : t;
    };
    const crlf = String.fromCharCode(13, 10);
    const body = String.fromCharCode(0xfeff) + [head.join(","), ...rows.map((r) => r.map(cell).join(","))].join(crlf) + crlf;
    const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `usage-${state.tab}.csv`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function bind() {
    $("tabs").addEventListener("click", (event) => {
      const value = event.target.closest("button")?.dataset.tab;
      if (!value || value === state.tab) return;
      state.tab = value; state.expanded.clear();
      renderPeriods();
      if (value === "log") loadLog(); else renderTable();
      renderFoot();
    });
    $("periods").addEventListener("click", (event) => {
      const value = event.target.closest("button")?.dataset.period;
      if (!value || value === state.period) return;
      state.period = value; state.expanded.clear(); state.log.offset = 0;
      store.set("route-cost.period", value);
      renderPeriods(); load({ fresh: true });
    });
    $("min-tokens").addEventListener("change", (event) => {
      state.minTokens = Number(event.target.value) || 0;
      store.set("route-cost.minTokens", String(state.minTokens));
      state.expanded.clear();
      renderFilters();
      renderMetrics();
      if (state.tab === "log") loadLog(); else renderTable();
      renderFoot();
    });

    $("currency").addEventListener("click", (event) => {
      const value = event.target.closest("button")?.dataset.currency;
      if (!value || value === state.currency) return;
      state.currency = value; store.set("route-cost.currency", value);
      renderPeriods(); renderMetrics(); renderHeatmap(); renderTable(); renderFoot();
    });
    $("refresh").addEventListener("click", () => load({ fresh: true }));
    $("export").addEventListener("click", exportCsv);
    let searchTimer = 0;
    $("search").addEventListener("input", (event) => {
      state.query = event.target.value;
      if (state.tab === "log") {
        state.log.offset = 0;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(loadLog, 250);
      } else renderTable();
    });
    $("expand-all").addEventListener("change", (event) => {
      state.expandAll = Boolean(event.target.checked); state.expanded.clear();
      if (state.expandAll && state.data) {
        if (state.tab === "providers") for (const p of buildProviders()) state.expanded.add(p.key);
        else for (const m of buildModels()) state.expanded.add(m.key);
      }
      renderTable();
    });
    $("prev-page").addEventListener("click", () => { state.log.offset = Math.max(0, state.log.offset - state.log.limit); loadLog(); });
    $("next-page").addEventListener("click", () => { state.log.offset += state.log.limit; loadLog(); });
    for (const host of document.querySelectorAll(".filter")) {
      host.querySelector(".filter-btn").addEventListener("click", (event) => {
        event.stopPropagation();
        const menu = host.querySelector(".filter-menu");
        const open = !menu.hidden;
        closeMenus();
        if (!open) { menu.hidden = false; host.querySelector(".filter-btn").setAttribute("aria-expanded", "true"); }
      });
    }
    document.addEventListener("click", closeMenus);
    window.addEventListener("focus", () => { if (Date.now() - (state.loadedAt || 0) > 60_000) load(); });
    let heatTimer = 0;
    window.addEventListener("resize", () => { clearTimeout(heatTimer); heatTimer = setTimeout(renderHeatmap, 150); });
    setInterval(() => { if (!document.hidden) load(); }, 60_000);
  }

  applyTheme(); applyLanguage();
  const savedPeriod = store.get("route-cost.period");
  if (savedPeriod && ["today", "7d", "30d", "all"].includes(savedPeriod)) state.period = savedPeriod;
  const urlTab = new URLSearchParams(location.search).get("tab");
  if (urlTab === "models" || urlTab === "providers" || urlTab === "log") state.tab = urlTab;
  const storedMin = store.get("route-cost.minTokens");
  if (storedMin != null) {
    const savedMin = Number(storedMin);
    if (Number.isFinite(savedMin) && savedMin >= 0) state.minTokens = savedMin;
  }
  const savedCurrency = store.get("route-cost.currency");
  if (savedCurrency === "cny" || savedCurrency === "usd") state.currency = savedCurrency;
  bind(); renderPeriods(); load();
})();
