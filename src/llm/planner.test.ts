import { describe, expect, it } from "vitest";
import { normalizePlan } from "./planner.js";

const X_LIMIT = 280;

describe("normalizePlan", () => {
  it("keeps known media refs and drops unknown ones", () => {
    const plan = normalizePlan(
      "x",
      { units: [{ text: "Short post", mediaRefs: ["img1", "unknown"] }] },
      new Set(["img1"])
    );

    expect(plan.units[0]).toEqual({ text: "Short post", mediaRefs: ["img1"] });
  });

  it("drops units that have neither text nor media", () => {
    const plan = normalizePlan(
      "bluesky",
      { units: [{ text: "  " }, { text: "kept" }] },
      new Set()
    );

    expect(plan.units.map((unit) => unit.text)).toEqual(["kept"]);
  });

  it("throws when there are no publishable units", () => {
    expect(() => normalizePlan("x", { units: [] }, new Set())).toThrow(/no publishable units/);
  });

  describe("char-limit splitting", () => {
    it("splits over-limit text into chunks that each fit the platform limit", () => {
      const longText = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
      const plan = normalizePlan("x", { units: [{ text: longText }] }, new Set());

      expect(plan.units.length).toBeGreaterThan(1);
      for (const unit of plan.units) {
        expect([...unit.text].length).toBeLessThanOrEqual(X_LIMIT);
      }
      // Only the first chunk carries media refs.
      expect(plan.units.slice(1).every((unit) => (unit.mediaRefs?.length ?? 0) === 0)).toBe(true);
    });

    it("never cuts a multi-code-unit emoji in half", () => {
      const emoji = "👨‍👩‍👧"; // ZWJ family sequence (multiple code points)
      const text = `${emoji} `.repeat(120).trim();
      const plan = normalizePlan("x", { units: [{ text }] }, new Set());

      for (const unit of plan.units) {
        expect(unit.text).not.toContain("�"); // no replacement char from a broken surrogate
      }
      // Every emoji that survives is intact (no partial ZWJ fragments).
      const rejoined = plan.units.map((unit) => unit.text.replaceAll("...", "")).join(" ");
      expect(rejoined.includes(emoji)).toBe(true);
    });

    it("keeps a long URL intact rather than splitting it mid-string", () => {
      const url = "https://example.com/very/long/path/that/keeps/going/and/going/segment";
      const filler = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
      const plan = normalizePlan("x", { units: [{ text: `${filler} ${url} more text here` }] }, new Set());

      const chunkWithUrl = plan.units.find((unit) => unit.text.includes("https://example.com"));
      expect(chunkWithUrl?.text).toContain(url);
    });
  });
});
