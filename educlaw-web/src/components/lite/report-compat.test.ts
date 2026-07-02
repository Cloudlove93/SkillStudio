import { strict as assert } from "node:assert";
import test from "node:test";
import type { ArenaReport } from "@educlaw/shared";
import { isArenaReport, parseStoredArenaReport } from "./report-compat.ts";

const validReport: ArenaReport = {
  threadId: 1,
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
    threadId: 1,
    baseline: { summary: "", total: 1 },
    enhanced: { summary: "", total: 2, dimensions: [] },
    recommendation: "",
    winningSide: "enhanced",
  };

  assert.equal(isArenaReport(malformed), false);
});

test("isArenaReport accepts server-produced report with numeric threadId", () => {
  const serverReport = {
    threadId: 42,
    baseline: {
      summary: "Baseline response",
      total: 60,
      dimensions: [
        { key: "accuracy", name: "准确性", score: 30, maxScore: 40, reason: "基本正确" },
        { key: "clarity", name: "清晰度", score: 20, maxScore: 30, reason: "表达一般" },
      ],
    },
    enhanced: {
      summary: "Enhanced response",
      total: 85,
      dimensions: [
        { key: "accuracy", name: "准确性", score: 40, maxScore: 40, reason: "更完整" },
        { key: "clarity", name: "清晰度", score: 30, maxScore: 30, reason: "表达更清楚" },
      ],
    },
    recommendation: "采用增强回答",
    winningSide: "enhanced" as const,
  };

  assert.equal(isArenaReport(serverReport), true);
  assert.deepEqual(parseStoredArenaReport(JSON.stringify(serverReport)), serverReport);
});

test("isArenaReport rejects string threadId (legacy format)", () => {
  const legacyReport = {
    threadId: "thread-1",
    baseline: {
      summary: "baseline",
      total: 10,
      dimensions: [
        { key: "accuracy", name: "准确性", score: 5, maxScore: 10, reason: "ok" },
      ],
    },
    enhanced: {
      summary: "enhanced",
      total: 15,
      dimensions: [
        { key: "accuracy", name: "准确性", score: 8, maxScore: 10, reason: "better" },
      ],
    },
    recommendation: "采用增强回答",
    winningSide: "enhanced" as const,
  };

  assert.equal(isArenaReport(legacyReport), false);
});
