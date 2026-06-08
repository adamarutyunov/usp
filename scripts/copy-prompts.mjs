import { cpSync } from "node:fs";

// tsc only emits .ts -> .js, so copy the prompt markdown alongside the compiled module.
cpSync("src/llm/prompts", "dist/llm/prompts", { recursive: true });
