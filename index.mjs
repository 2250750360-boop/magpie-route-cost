// The host part of the plugin: Magpie's Bun host loads it and asks it for
// the page's service. The service runs inside that host, so it stops when
// Magpie stops the plugin.
import { startServer } from "./lib/server.mjs";

let started = null;

export default {
  id: "magpie-route-cost",
  server: async (_input, options) => {
    if (!started) {
      started = startServer({
        port: Number(options?.port) || 3495,
        usdCny: Number(options?.usdCny) || 6.8,
      }).catch((error) => {
        started = null;
        throw error;
      });
    }
    await started;
    return {};
  },
};
