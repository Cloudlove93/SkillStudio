import { strict as assert } from "node:assert";
import test from "node:test";
import { canOpenReportAction, getReportReadiness } from "./report-status.ts";

test("report readiness requires a usable rubric first", () => {
  const readiness = getReportReadiness([], false);

  assert.equal(readiness.canGenerateReport, false);
  assert.equal(readiness.reason, "missing_rubric");
});

test("report readiness explains when arena replies are missing", () => {
  const readiness = getReportReadiness([], true);

  assert.equal(readiness.canGenerateReport, false);
  assert.equal(readiness.reason, "missing_messages");
});

test("report readiness passes after one compare turn exists", () => {
  const readiness = getReportReadiness([
    { side: "shared", role: "user" },
    { side: "baseline", role: "assistant" },
    { side: "enhanced", role: "assistant" },
  ], true);

  assert.equal(readiness.canGenerateReport, true);
  assert.equal(readiness.reason, null);
});

test("report readiness waits until the final arena reply save has finished", () => {
  const readiness = getReportReadiness([
    { side: "shared", role: "user" },
    { side: "baseline", role: "assistant" },
    { side: "enhanced", role: "assistant" },
  ], true, true);

  assert.equal(readiness.canGenerateReport, false);
  assert.equal(readiness.reason, "generating_reply");
});

test("report action stays disabled before a complete compare turn exists", () => {
  assert.equal(canOpenReportAction(true, false), false);
});

test("report action is enabled when a report can be generated", () => {
  assert.equal(canOpenReportAction(true, true), true);
});

test("report action stays disabled when rubric is missing", () => {
  assert.equal(canOpenReportAction(true, false), false);
});

test("report action stays disabled when thread is missing", () => {
  assert.equal(canOpenReportAction(false, true), false);
});
