import type { Readable, Writable } from "node:stream";

import { Prompt, isCancel } from "@clack/core";
import pc from "yoctocolors";

import type { Platform, PostMode } from "../types.js";
import { platformName } from "../util/display.js";

export type PostTargetRow = {
  id: string;
  platform: Platform;
  account: string;
  mode: PostMode;
};

const CYCLE: PostMode[] = ["off", "as-is", "llm"];

function nextMode(mode: PostMode, direction: 1 | -1): PostMode {
  const index = CYCLE.indexOf(mode);
  const length = CYCLE.length;
  return CYCLE[(index + direction + length) % length]!;
}

function modeIcon(mode: PostMode) {
  if (mode === "llm") return pc.green("●");
  if (mode === "as-is") return pc.yellow("◐");
  return pc.dim("○");
}

function modeLabel(mode: PostMode) {
  if (mode === "llm") return pc.green("LLM");
  if (mode === "as-is") return pc.yellow("as-is");
  return pc.dim("off");
}

class PostTargetPrompt extends Prompt<PostTargetRow[]> {
  readonly rows: PostTargetRow[];
  private index = 0;
  private readonly labelWidth: number;

  constructor(rows: PostTargetRow[], io: { input?: Readable; output?: Writable } = {}) {
    super(
      {
        input: io.input,
        output: io.output,
        render() {
          return (this as unknown as PostTargetPrompt).frame();
        },
      },
      false
    );

    this.rows = rows.map((row) => ({ ...row }));
    this.value = this.rows;
    this.labelWidth = this.rows.reduce((max, row) => Math.max(max, this.rowLabel(row).length), 0);

    this.on("cursor", (action) => {
      if (action === "up") {
        this.index = (this.index - 1 + this.rows.length) % this.rows.length;
      } else if (action === "down") {
        this.index = (this.index + 1) % this.rows.length;
      } else if (action === "space" || action === "right") {
        const row = this.rows[this.index];
        if (row) row.mode = nextMode(row.mode, 1);
      } else if (action === "left") {
        const row = this.rows[this.index];
        if (row) row.mode = nextMode(row.mode, -1);
      }
      this.value = this.rows;
    });
  }

  private rowLabel(row: PostTargetRow) {
    return `${row.id} (${platformName(row.platform)}/${row.account})`;
  }

  private frame() {
    const bar = pc.gray("│");

    if (this.state === "submit" || this.state === "cancel") {
      const head = this.state === "cancel" ? pc.red("■") : pc.green("◇");
      const title = this.state === "cancel" ? pc.dim("Cancelled") : "Targets selected";
      const chosen = this.rows.filter((row) => row.mode !== "off");
      const summary =
        this.state === "cancel"
          ? ""
          : chosen.length === 0
            ? pc.dim("none")
            : chosen.map((row) => `${row.id} ${modeLabel(row.mode)}`).join(", ");
      return `${head}  ${title}${summary ? `\n${bar}  ${summary}` : ""}`;
    }

    const lines = [
      `${pc.cyan("◆")}  Select targets to post`,
      `${bar}  ${pc.dim("↑/↓ move · space cycles off → as-is → LLM · enter confirm")}`,
    ];
    for (const [rowIndex, row] of this.rows.entries()) {
      const focused = rowIndex === this.index;
      const pointer = focused ? pc.cyan("❯") : " ";
      const padded = this.rowLabel(row).padEnd(this.labelWidth);
      const label = focused ? padded : pc.dim(padded);
      lines.push(`${bar}  ${pointer} ${modeIcon(row.mode)} ${label}  ${modeLabel(row.mode)}`);
    }
    lines.push(pc.gray("└"));
    return lines.join("\n");
  }
}

/** Returns the chosen rows, or `null` if the user cancelled (Ctrl+C / Escape). */
export async function pickPostTargets(
  rows: PostTargetRow[],
  io: { input?: Readable; output?: Writable } = {}
): Promise<PostTargetRow[] | null> {
  const result = await new PostTargetPrompt(rows, io).prompt();
  if (isCancel(result)) {
    return null;
  }
  return result as PostTargetRow[];
}
