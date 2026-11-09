import test from "node:test";
import assert from "node:assert/strict";
import { canonicalModel } from "../lib/canonical.mjs";

test("provider aliases of one model fold together", () => {
  const names = [
    "k3.1-pro",
    "Kimi-K3.1-Pro",
    "kimi-k3.1-pro-max",
    "k3d1-agent",
    "kmodel_latest",
    "kimi-code/k3.1-pro",
  ];
  for (const name of names) assert.equal(canonicalModel(name), "Kimi K3.1 Pro");
});

test("deepseek, qwen and glm aliases fold", () => {
  for (const name of ["deepseek-flash", "Bailian/deepseek-v4.1-flash", "deepseek-v4.1-flash-max", "dfmodel"]) {
    assert.equal(canonicalModel(name), "DeepSeek V4.1 Flash");
  }
  assert.equal(canonicalModel("qwen3.8-max-max"), "Qwen3.8 Max");
  assert.equal(canonicalModel("qfmodel"), "Qwen3.8 Flash");
  assert.equal(canonicalModel("glm-5.3-max"), "GLM-5.3");
  assert.equal(canonicalModel("gfmodel"), "GLM-5.3 Flash");
});

test("different models stay apart", () => {
  assert.notEqual(canonicalModel("gpt-6.1-sol"), canonicalModel("gpt-6.1-terra"));
  assert.equal(canonicalModel("gpt-6.1-sol"), "GPT-6.1 Sol");
  assert.equal(canonicalModel("claude-opus-5-5"), "Claude Opus 5.5");
  assert.equal(canonicalModel("hy4free"), "Hunyuan Hy4");
});
