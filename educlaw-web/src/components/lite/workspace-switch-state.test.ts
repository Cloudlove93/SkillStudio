import { strict as assert } from "node:assert";
import test from "node:test";
import { getPackageSwitchDecision } from "./workspace-switch-state.ts";

test("package switching preserves transient progress UI while an operation is active", () => {
  const decision = getPackageSwitchDecision({
    hasActiveProgress: true,
    preserveGenerateProgress: false,
  });

  assert.deepEqual(decision, {
    preserveTransientState: true,
    clearCenterPreview: false,
    clearProgress: false,
    clearGeneratePreviews: false,
    clearSideStreaming: false,
  });
});

test("package switching still preserves transient progress during generated-package auto-open", () => {
  const decision = getPackageSwitchDecision({
    hasActiveProgress: false,
    preserveGenerateProgress: true,
  });

  assert.deepEqual(decision, {
    preserveTransientState: true,
    clearCenterPreview: true,
    clearProgress: false,
    clearGeneratePreviews: false,
    clearSideStreaming: false,
  });
});

test("idle package switching clears transient UI state", () => {
  const decision = getPackageSwitchDecision({
    hasActiveProgress: false,
    preserveGenerateProgress: false,
  });

  assert.deepEqual(decision, {
    preserveTransientState: false,
    clearCenterPreview: true,
    clearProgress: true,
    clearGeneratePreviews: true,
    clearSideStreaming: true,
  });
});
