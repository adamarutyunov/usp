import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { pickPostTargets, type PostTargetRow } from "./post-picker.js";

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function press(input: PassThrough, sequence: string | undefined, name: string) {
  input.emit("keypress", sequence, { name, sequence });
}

function shiftA(input: PassThrough) {
  input.emit("keypress", "A", { name: "a", shift: true, sequence: "A" });
}

function makeRows(): PostTargetRow[] {
  return [
    { id: "x-main", platform: "x", account: "main", mode: "off" },
    { id: "reddit-news", platform: "reddit", account: "main", mode: "llm" },
  ];
}

describe("pickPostTargets", () => {
  it("cycles per-target modes and returns the selection", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();

    const promise = pickPostTargets(makeRows(), { input, output });
    await tick();

    press(input, " ", "space"); // row 0: off -> as-is
    press(input, undefined, "down"); // focus row 1
    press(input, " ", "space"); // row 1: llm -> off
    press(input, "\r", "return"); // submit

    const result = await promise;
    expect(result).toEqual([
      { id: "x-main", platform: "x", account: "main", mode: "as-is" },
      { id: "reddit-news", platform: "reddit", account: "main", mode: "off" },
    ]);
  });

  it("cycles backward with left and wraps around", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();

    const promise = pickPostTargets(makeRows(), { input, output });
    await tick();

    press(input, undefined, "left"); // row 0: off -> llm (wrap backward)
    press(input, "\r", "return");

    const result = (await promise) as PostTargetRow[];
    expect(result[0]!.mode).toBe("llm");
  });

  it("disables all targets with shift+A", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();

    const promise = pickPostTargets(makeRows(), { input, output });
    await tick();

    shiftA(input); // shift+A → all off
    press(input, "\r", "return");

    const result = (await promise) as PostTargetRow[];
    expect(result.map((row) => row.mode)).toEqual(["off", "off"]);
  });

  it("restores prior modes on a second shift+A when nothing changed", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();

    const promise = pickPostTargets(makeRows(), { input, output });
    await tick();

    shiftA(input); // disable all
    shiftA(input); // undo → back to off, llm
    press(input, "\r", "return");

    const result = (await promise) as PostTargetRow[];
    expect(result.map((row) => row.mode)).toEqual(["off", "llm"]);
  });

  it("disables again (no undo) when a mode changed after shift+A", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();

    const promise = pickPostTargets(makeRows(), { input, output });
    await tick();

    shiftA(input); // disable all
    press(input, " ", "space"); // row 0 off -> as-is (invalidates undo)
    shiftA(input); // disables all again rather than restoring
    press(input, "\r", "return");

    const result = (await promise) as PostTargetRow[];
    expect(result.map((row) => row.mode)).toEqual(["off", "off"]);
  });

  it("returns null on ctrl+c", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();

    const promise = pickPostTargets(makeRows(), { input, output });
    await tick();

    input.emit("keypress", "\x03", { name: "c", ctrl: true, sequence: "\x03" });

    const result = await promise;
    expect(result).toBeNull();
  });
});
