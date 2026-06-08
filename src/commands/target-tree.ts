import type { Readable, Writable } from "node:stream";

import { Prompt, isCancel } from "@clack/core";
import pc from "yoctocolors";

import type { Platform } from "../types.js";

export type TreeRow =
  | { kind: "platform"; platform: Platform; label: string; promptBadge?: string }
  | { kind: "account"; platform: Platform; account: string; label: string; status: string }
  | {
      kind: "target";
      platform: Platform;
      account: string;
      target: string;
      label: string;
      routing?: string;
      needsDestination?: boolean;
      promptBadge?: string;
    }
  | { kind: "add-account" };

export type TreeAction = { kind: "done" } | { kind: "select"; row: TreeRow };

const KEYS = "↑/↓ move · enter options · esc done";

// Platform headers: a light grey between white and dim, a touch brighter when selected. Never bold.
function platformLabel(label: string, focused: boolean) {
  const rgb = focused ? "210;210;210" : "160;160;160";
  return `\x1b[38;2;${rgb}m${label}\x1b[39m`;
}

/** Stable identity for a row, so the cursor can return to it after re-rendering the tree. */
export function rowKey(row: TreeRow): string {
  if (row.kind === "add-account") return "add-account";
  if (row.kind === "platform") return `platform:${row.platform}`;
  if (row.kind === "account") return `account:${row.platform}/${row.account}`;
  return `target:${row.platform}/${row.account}/${row.target}`;
}

class TargetTreePrompt extends Prompt<TreeAction> {
  private index = 0;

  constructor(
    private readonly rows: TreeRow[],
    io: { input?: Readable; output?: Writable; selectedKey?: string } = {}
  ) {
    super(
      {
        input: io.input,
        output: io.output,
        render() {
          return (this as unknown as TargetTreePrompt).frame();
        },
      },
      false
    );
    this.value = { kind: "done" };
    if (io.selectedKey) {
      const found = this.rows.findIndex((row) => rowKey(row) === io.selectedKey);
      if (found >= 0) this.index = found;
    }

    this.on("key", (_char, key) => {
      const name = key?.name;
      if (name === "up") return this.move(-1);
      if (name === "down") return this.move(1);
      const row = this.rows[this.index];
      if (name === "return") {
        this.value = row ? { kind: "select", row } : { kind: "done" };
        this.state = "submit";
        return;
      }
      if (name === "q") {
        this.value = { kind: "done" };
        this.state = "submit";
      }
    });
  }

  private move(delta: number) {
    if (this.rows.length === 0) return;
    this.index = (this.index + delta + this.rows.length) % this.rows.length;
  }

  private renderRow(row: TreeRow, focused: boolean) {
    const pointer = focused ? pc.green("❯") : " ";

    if (row.kind === "add-account") {
      const label = focused ? pc.green("+ Add account") : pc.dim("+ Add account");
      return `${pointer} ${label}`;
    }
    if (row.kind === "platform") {
      const badge = row.promptBadge ? `  ${pc.dim(row.promptBadge)}` : "";
      return `${pointer} ${platformLabel(row.label, focused)}${badge}`;
    }
    if (row.kind === "account") {
      const label = focused ? row.label : pc.dim(row.label);
      return `${pointer}   ${label}  ${pc.dim(row.status)}`;
    }
    const label = focused ? row.label : pc.dim(row.label);
    const dest = row.needsDestination
      ? pc.yellow("⚠ no destination")
      : row.routing
        ? pc.dim(row.routing)
        : "";
    const badge = row.promptBadge ? `  ${pc.dim(row.promptBadge)}` : "";
    return `${pointer}     ${label}  ${dest}${badge}`;
  }

  private frame() {
    const bar = pc.gray("│");
    if (this.state === "submit" || this.state === "cancel") {
      return `${pc.green("◇")}  Targets`;
    }

    const lines = [`${pc.cyan("◆")}  Targets`, `${bar}  ${pc.dim(KEYS)}`];

    for (const [i, row] of this.rows.entries()) {
      if (row.kind === "platform" || row.kind === "add-account") {
        lines.push(bar); // blank line before each platform section and the add-account row
      }
      lines.push(`${bar}  ${this.renderRow(row, i === this.index)}`);
    }
    lines.push(pc.gray("└"));
    return lines.join("\n");
  }
}

export async function browseTargets(
  rows: TreeRow[],
  io: { input?: Readable; output?: Writable; selectedKey?: string } = {}
): Promise<TreeAction> {
  const result = await new TargetTreePrompt(rows, io).prompt();
  if (isCancel(result)) {
    return { kind: "done" };
  }
  return result as TreeAction;
}
