import { describe, expect, it } from "vitest";

import { one } from "./http.js";

describe("one", () => {
  it("returns the original string value", () => {
    expect(one("package-1")).toBe("package-1");
  });

  it("returns the first item for array values", () => {
    expect(one(["first", "second"])).toBe("first");
  });

  it("returns an empty string for empty arrays", () => {
    expect(one([])).toBe("");
  });

  it("returns an empty string for undefined", () => {
    expect(one(undefined)).toBe("");
  });

  it("preserves an empty string input", () => {
    expect(one("")).toBe("");
  });
});
