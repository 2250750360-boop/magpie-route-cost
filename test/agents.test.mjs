import test from "node:test";
import assert from "node:assert/strict";
import { agentKey, isSystemAgent } from "../lib/agents.mjs";

test("agent aliases fold and probes are system", () => {
  assert.equal(agentKey("kimi-code-desktop"), "kimi-code");
  assert.equal(agentKey("Kimi Code"), "kimi-code");
  assert.equal(agentKey("_codex_session"), "codex");
  assert.equal(agentKey("_dsh_account_session"), "dsh");
  assert.equal(agentKey("claude-desktop"), "claude");
  assert.equal(agentKey("qoder-cn"), "qoder-cn");
  assert.ok(isSystemAgent("curl"));
  assert.ok(isSystemAgent("node"));
  assert.ok(!isSystemAgent("qoder"));
});
