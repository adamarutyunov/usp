import type { Readable, Writable } from "node:stream";

import { Prompt, isCancel } from "@clack/core";
import pc from "yoctocolors";

import type { Platform, PromptLayer } from "../types.js";

export type TreeRow =
  | { kind: "platform"; platform: Platform; label: string; prompt?: PromptLayer }
  | { kind: "account"; platform: Platform; account: string; label: string }
  | {
      kind: "target";
      platform: Platform;
      account: string;
      target: string;
      label: string;
      routing?: string;
      needsDestination?: boolean;
      prompt?: PromptLayer;
    }
  | { kind: "no-target"; platform: Platform; account: string }
  | { kind: "add-account" };

export type TreeAction = { kind: "done" } | { kind: "select"; row: TreeRow };

const KEYS = "↑/↓ move · enter options · esc done";

function paint(label: string, rgb: string) {
  return `\x1b[38;2;${rgb}m${label}\x1b[39m`;
}

// Row palette: platforms/add-account white, accounts light grey, all turn green when
// focused. A target's routing id (e.g. a Telegram channel) is always light blue.
const WHITE = "235;235;235";
const GREY = "160;160;160";
const LIGHT_BLUE = "125;175;255";

// Platform headers: white, green when selected. Never bold.
function platformLabel(label: string, focused: boolean) {
  return focused ? pc.green(label) : paint(label, WHITE);
}

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function visibleLength(text: string) {
  return [...text.replace(ANSI_PATTERN, "")].length;
}

function terminalWidth() {
  const columns = process.stdout.columns;
  return columns && columns > 0 ? columns : 80;
}

/**
 * Prompt indicator: a half circle for append, a full circle for replace, followed by a
 * grey preview of the human-entered prompt text, truncated to the terminal width.
 * `head` is the already-built, visible row content the badge will follow.
 */
function promptBadge(prompt: PromptLayer | undefined, head: string) {
  if (!prompt) {
    return "";
  }
  const circle = prompt.mode === "replace" ? "⏺" : "◗";
  const text = prompt.text.replace(/\s+/g, " ").trim();
  if (!text) {
    return `  ${pc.dim(circle)}`;
  }
  // Account for the "│  " frame prefix (3), the visible head, "  " + circle + " ".
  const used = 3 + visibleLength(head) + 2 + 2;
  const budget = Math.max(8, terminalWidth() - used - 1);
  const codepoints = [...text];
  const shown = codepoints.length > budget ? `${codepoints.slice(0, budget).join("")}…` : text;
  return `  ${pc.dim(circle)} ${pc.dim(shown)}`;
}

/** Stable identity for a row, so the cursor can return to it after re-rendering the tree. */
export function rowKey(row: TreeRow): string {
  if (row.kind === "add-account") return "add-account";
  if (row.kind === "platform") return `platform:${row.platform}`;
  if (row.kind === "account") return `account:${row.platform}/${row.account}`;
  if (row.kind === "no-target") return `no-target:${row.platform}/${row.account}`;
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
      const label = focused ? pc.green("+ Add account") : paint("+ Add account", WHITE);
      return `${pointer} ${label}`;
    }
    if (row.kind === "platform") {
      const head = `${pointer} ${platformLabel(row.label, focused)}`;
      return `${head}${promptBadge(row.prompt, head)}`;
    }
    if (row.kind === "account") {
      const label = focused ? pc.green(row.label) : paint(row.label, GREY);
      return `${pointer}   ${label}`;
    }
    if (row.kind === "no-target") {
      // Always yellow to flag the empty account; the green pointer still marks focus.
      return `${pointer}     ${pc.yellow("No targets")}`;
    }
    const label = focused ? pc.green(row.label) : pc.dim(row.label);
    const dest = row.needsDestination
      ? pc.yellow("⚠ no destination")
      : row.routing
        ? paint(row.routing, LIGHT_BLUE)
        : "";
    const head = `${pointer}     ${label}  ${dest}`;
    return `${head}${promptBadge(row.prompt, head)}`;
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

/** A choice in {@link pickFromList}. `muted` renders grey (e.g. already-used), otherwise white. */
export type PickItem = { value: string; label: string; hint?: string; muted?: boolean };

class ListPrompt extends Prompt<string | null> {
  private index = 0;

  constructor(
    private readonly title: string,
    private readonly items: PickItem[],
    io: { input?: Readable; output?: Writable } = {}
  ) {
    super(
      {
        input: io.input,
        output: io.output,
        render() {
          return (this as unknown as ListPrompt).frame();
        },
      },
      false
    );
    this.value = null;

    this.on("key", (_char, key) => {
      const name = key?.name;
      if (name === "up") return this.move(-1);
      if (name === "down") return this.move(1);
      if (name === "return") {
        this.value = this.items[this.index]?.value ?? null;
        this.state = "submit";
      }
    });
  }

  private move(delta: number) {
    if (this.items.length === 0) return;
    this.index = (this.index + delta + this.items.length) % this.items.length;
  }

  private frame() {
    const bar = pc.gray("│");
    if (this.state === "submit" || this.state === "cancel") {
      return `${pc.green("◇")}  ${this.title}`;
    }
    const lines = [`${pc.cyan("◆")}  ${this.title}`, `${bar}  ${pc.dim("↑/↓ move · enter select · esc cancel")}`];
    for (const [i, item] of this.items.entries()) {
      const focused = i === this.index;
      const pointer = focused ? pc.green("❯") : " ";
      // Already-used items are dimmed to match the hint "captions" on the right.
      const label = focused ? pc.green(item.label) : item.muted ? pc.dim(item.label) : paint(item.label, WHITE);
      const hint = item.hint ? `  ${pc.dim(item.hint)}` : "";
      lines.push(`${bar}  ${pointer} ${label}${hint}`);
    }
    lines.push(pc.gray("└"));
    return lines.join("\n");
  }
}

/** Single-select list with the tree's palette (white/grey items, green on focus). Returns null on cancel. */
export async function pickFromList(
  title: string,
  items: PickItem[],
  io: { input?: Readable; output?: Writable } = {}
): Promise<string | null> {
  const result = await new ListPrompt(title, items, io).prompt();
  if (isCancel(result)) {
    return null;
  }
  return result as string | null;
}
