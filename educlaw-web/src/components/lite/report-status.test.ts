import { strict as assert } from "node:assert";
import test from "node:test";
import { canOpenReportAction, getReportReadiness } from "./report-status";

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

test("report action stays visible when rubric exists even before messages", () => {
  assert.equal(canOpenReportAction(true, true), true);
});

test("report action stays visible so users can read missing rubric guidance", () => {
  assert.equal(canOpenReportAction(true, false), true);
});

test("report action stays disabled only when thread is missing", () => {
  assert.equal(canOpenReportAction(false, true), false);
});
