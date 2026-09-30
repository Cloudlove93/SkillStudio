import { strict as assert } from "node:assert";
import test from "node:test";
import type { ArenaReport } from "@educlaw/shared";
import {
  buildGeneratedReportViewState,
  buildReportCompletionStatusMessage,
} from "./report-preview-state.ts";

const report: ArenaReport = {
  threadId: 1,
  baseline: {
    summary: "baseline summary",
    total: 18,
    dimensions: [
      { key: "fit", name: "角色贴合", score: 8, maxScore: 10, reason: "基本符合" },
    ],
  },
  enhanced: {
    summary: "enhanced summary",
    total: 26,
    dimensions: [
      { key: "fit", name: "角色贴合", score: 9, maxScore: 10, reason: "更稳定" },
    ],
  },
  recommendation: "优先使用增强回答",
  winningSide: "enhanced",
};

test("report completion opens the generated report in the center panel", () => {
  const nextState = buildGeneratedReportViewState(report);

  assert.equal(nextState.detailTab, "report");
  assert.deepEqual(nextState.centerPreview, {
    type: "report",
    name: "评估报告",
    report,
  });
});

test("report completion status explains when the user switched away mid-run", () => {
  assert.equal(buildReportCompletionStatusMessage(true), "报告已生成");
  assert.equal(
    buildReportCompletionStatusMessage(false),
    "报告已生成，可返回原智能体查看",
  );
});
