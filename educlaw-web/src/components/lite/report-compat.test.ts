import { strict as assert } from "node:assert";
import test from "node:test";
import type { ArenaReport } from "@educlaw/shared";
import { isArenaReport, parseStoredArenaReport } from "./report-compat";

const validReport: ArenaReport = {
  threadId: "thread-1",
  baseline: {
    summary: "baseline summary",
    total: 12,
    dimensions: [
      { key: "accuracy", name: "准确性", score: 5, maxScore: 10, reason: "基本正确" },
    ],
  },
  enhanced: {
    summary: "enhanced summary",
    total: 16,
    dimensions: [
      { key: "accuracy", name: "准确性", score: 8, maxScore: 10, reason: "更完整" },
    ],
  },
  recommendation: "采用增强回答",
  winningSide: "enhanced",
};

test("parseStoredArenaReport accepts current ArenaReport payload", () => {
  const parsed = parseStoredArenaReport(JSON.stringify(validReport));
  assert.deepEqual(parsed, validReport);
});

test("parseStoredArenaReport rejects legacy run-view payload", () => {
  const legacyRunView = {
    run: { id: "run-1" },
    baseline: { totalScore: 1, summary: "", dimensions: [] },
    enhanced: { totalScore: 47, summary: "", dimensions: [] },
    report: { delta: 46, recommendation: "enhanced better" },
    evaluation_spec: { dimensions: [] },
  };

  assert.equal(parseStoredArenaReport(JSON.stringify(legacyRunView)), null);
});

test("isArenaReport rejects thin malformed cached payload", () => {
  const malformed = {
    threadId: "thread-1",
    baseline: { summary: "", total: 1 },
    enhanced: { summary: "", total: 2, dimensions: [] },
    recommendation: "",
    winningSide: "enhanced",
  };

  assert.equal(isArenaReport(malformed), false);
});
