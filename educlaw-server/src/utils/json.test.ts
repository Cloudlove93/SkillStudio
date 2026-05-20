import { describe, expect, it } from "vitest";

import { extractFirstJsonObject, parseJsonObject } from "./json.js";

describe("extractFirstJsonObject", () => {
  it("returns null when the input does not contain a JSON object", () => {
    expect(extractFirstJsonObject("plain text [1, 2, 3]")).toBeNull();
  });

  it("extracts the first complete object from surrounding text", () => {
    const raw = 'prefix {"name":"educlaw","meta":{"score":1}} suffix {"ignored":true}';

    expect(extractFirstJsonObject(raw)).toBe('{"name":"educlaw","meta":{"score":1}}');
  });

  it("ignores braces inside quoted strings and escaped quotes", () => {
    const raw = String.raw`before {"text":"literal } brace and \"quoted { brace\"","ok":true} after`;

    expect(extractFirstJsonObject(raw)).toBe(
      String.raw`{"text":"literal } brace and \"quoted { brace\"","ok":true}`,
    );
  });

  it("returns null for an unterminated object", () => {
    expect(extractFirstJsonObject('prefix {"name":"missing end"')).toBeNull();
  });
});

describe("parseJsonObject", () => {
  it("parses a valid JSON object embedded in surrounding text", () => {
    expect(parseJsonObject<{ answer: number }>('Answer: {"answer":42}\nDone.')).toEqual({
      answer: 42,
    });
  });

  it("repairs and parses a JSON-like object", () => {
    expect(parseJsonObject<{ title: string; count: number }>("prefix {title: 'EduClaw', count: 2,} suffix")).toEqual({
      title: "EduClaw",
      count: 2,
    });
  });

  it("repairs and parses bare text as a JSON string", () => {
    expect(parseJsonObject<string>("not json at all")).toBe("not json at all");
  });
});
