import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { browseTargets, rowKey, type TreeRow } from "./target-tree.js";

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function key(input: PassThrough, name: string) {
  input.emit("keypress", undefined, { name });
}

function rows(): TreeRow[] {
  return [
    { kind: "platform", platform: "bluesky", label: "Bluesky" },
    { kind: "account", platform: "bluesky", account: "main", label: "main", status: "1 target" },
    { kind: "target", platform: "bluesky", account: "main", target: "default", label: "default" },
    { kind: "add-account" },
  ];
}

async function drive(names: string[], opts: { selectedKey?: string } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  const promise = browseTargets(rows(), { input, output, selectedKey: opts.selectedKey });
  await tick();
  for (const name of names) key(input, name);
  return promise;
}

describe("browseTargets", () => {
  it("enter selects the focused row", async () => {
    expect(await drive(["return"])).toMatchObject({ kind: "select", row: { kind: "platform", platform: "bluesky" } });
  });

  it("down then enter selects the next row", async () => {
    expect(await drive(["down", "return"])).toMatchObject({ kind: "select", row: { kind: "account", account: "main" } });
  });

  it("can select the add-account row", async () => {
    expect(await drive(["up", "return"])).toEqual({ kind: "select", row: { kind: "add-account" } });
  });

  it("starts the cursor on selectedKey", async () => {
    const target = { kind: "target", platform: "bluesky", account: "main", target: "default" } as const;
    expect(await drive(["return"], { selectedKey: rowKey(target) })).toMatchObject({ kind: "select", row: { kind: "target" } });
  });

  it("escape is done", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const promise = browseTargets(rows(), { input, output });
    await tick();
    input.emit("keypress", "\x1b", { name: "escape", sequence: "\x1b" });
    expect(await promise).toEqual({ kind: "done" });
  });
});
