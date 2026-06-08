import { describe, expect, it } from "vitest";
import { parseJsonObject } from "./json.js";

describe("parseJsonObject", () => {
  it("parses a bare JSON object", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips a ```json fence", () => {
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("ignores prose after the object, including stray braces", () => {
    expect(parseJsonObject('Sure! {"a":1} hope that helps :} more {text}')).toEqual({ a: 1 });
  });

  it("does not over-slice on braces inside string values", () => {
    expect(parseJsonObject('{"text":"a } b { c"}')).toEqual({ text: "a } b { c" });
  });

  it("handles escaped quotes inside strings", () => {
    expect(parseJsonObject('prefix {"text":"he said \\"hi\\" }"} suffix')).toEqual({ text: 'he said "hi" }' });
  });

  it("throws when there is no JSON object", () => {
    expect(() => parseJsonObject("no json here")).toThrow(/did not contain a JSON object/);
  });
});
