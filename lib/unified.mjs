// One history book, roughly deduplicated by time. Magpie's gateway is the
// precise ledger from its first request onward; CC Switch's history is used
// for everything before that. A session that started before the boundary and
// continued after it can land on both sides, which is why this book is an
// estimate and says so.

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
    lastAt: "",
    firstAt: "",
  };
}

function add(target, source) {
  target.calls += source.calls || 0;
  target.ok += source.ok || 0;
  target.failed += source.failed || 0;
  target.cost += source.cost || 0;
  target.credits += source.credits || 0;
  target.unpriced += source.unpriced || 0;
  target.input += source.input || 0;
  target.output += source.output || 0;
  target.cacheRead += source.cacheRead || 0;
  target.cacheWrite += source.cacheWrite || 0;
  if (source.lastAt && (!target.lastAt || source.lastAt > target.lastAt)) {
    target.lastAt = source.lastAt;
  }
  if (source.firstAt && (!target.firstAt || source.firstAt < target.firstAt)) {
    target.firstAt = source.firstAt;
  }
  return target;
}

function finish(target) {
  target.tokens = target.input + target.output;
  target.allTokens = target.tokens + target.cacheRead + target.cacheWrite;
  return target;
}

export function mergeBooks(period, gateway, cc, options = {}) {
  const routes = new Map();
  const total = blank();
  const daily = new Map();

  const take = (data, book) => {
    for (const route of data?.routes || []) {
      let target = routes.get(route.name);
      if (!target) {
        target = {
          name: route.name,
          direct: Boolean(route.direct),
          ...blank(),
          families: new Set(),
          members: new Map(),
          books: new Set(),
        };
        routes.set(route.name, target);
      }
      add(target, route);
      target.books.add(book);
      for (const name of route.families || []) target.families.add(name);
      for (const member of route.members || []) {
        const agent = member.agent || "";
        const key = `${agent}\u001f${member.provider}\u001f${member.model}`;
        let row = target.members.get(key);
        if (!row) {
          row = {
            agent,
            provider: member.provider,
            providerName: member.providerName || member.provider,
            model: member.model,
            canonical: member.canonical || member.model,
            ...blank(),
            books: new Set(),
          };
          target.members.set(key, row);
        }
        add(row, member);
        row.books.add(book);
        if (book === "gateway" && member.providerName) row.providerName = member.providerName;
      }
    }
    for (const cell of data?.daily || []) {
      const current = daily.get(cell.date) || { date: cell.date, calls: 0, cost: 0, tokens: 0 };
      current.calls += cell.calls || 0;
      current.cost += cell.cost || 0;
      current.tokens += cell.tokens || 0;
      daily.set(cell.date, current);
    }
    add(total, data?.totals || {});
  };

  take(gateway, "gateway");
  take(cc, "history");

  const out = [];
  for (const route of routes.values()) {
    finish(route);
    const members = [...route.members.values()]
      .map((member) => {
        finish(member);
        member.share = route.cost > 0 ? member.cost / route.cost : 0;
        member.avgCost = member.calls ? member.cost / member.calls : 0;
        member.book =
          member.books.size > 1 ? "both" : member.books.has("gateway") ? "gateway" : "history";
        return member;
      })
      .sort((a, b) => b.cost - a.cost || b.calls - a.calls);
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
      tokens: route.tokens,
      allTokens: route.allTokens,
      families: [...route.families].sort(),
      members,
      lastAt: route.lastAt,
      firstAt: route.firstAt,
      avgCost: route.calls ? route.cost / route.calls : 0,
      share: 0,
      book: route.books.size > 1 ? "both" : route.books.has("gateway") ? "gateway" : "history",
    });
  }

  out.sort((a, b) => {
    if (a.direct !== b.direct) return a.direct ? 1 : -1;
    return b.cost - a.cost || b.calls - a.calls || a.name.localeCompare(b.name);
  });
  finish(total);
  total.avgCost = total.calls ? total.cost / total.calls : 0;
  for (const route of out) route.share = total.cost > 0 ? route.cost / total.cost : 0;

  const cutoff = options.cutoff || gateway?.totals?.firstAt || "";
  return {
    period,
    generatedAt: new Date().toISOString(),
    source: "Combined history",
    totals: total,
    routes: out,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    dedupe: {
      cutoff,
      method: "time boundary",
      note:
        "Before Magpie's first gateway request this book uses CC Switch's history; from that request on it uses Magpie's ledger. Sessions crossing the boundary can be counted on both sides, so the total is an estimate.",
    },
  };
}
