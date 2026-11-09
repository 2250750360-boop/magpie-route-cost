import { startServer } from "./lib/server.mjs";

function arg(name, fallback) {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const port = Number(arg("--port", process.env.MAGPIE_ROUTE_COST_PORT || 3495));

const info = await startServer({ port });
console.log(`[route-cost] listening on http://127.0.0.1:${info.port}`);
