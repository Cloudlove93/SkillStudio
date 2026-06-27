import { strict as assert } from "node:assert";
import test from "node:test";
import { getDefaultDetailTab } from "./detail-tab";

test("detail panel defaults to report so evaluation guidance is always visible", () => {
  assert.equal(getDefaultDetailTab(), "report");
});
