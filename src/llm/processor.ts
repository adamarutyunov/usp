import type { LlmClient } from "./client.js";
import { LlmProcessor } from "../pipeline/contracts.js";
import { parseJsonObject } from "../util/json.js";

export class JsonLlmProcessor extends LlmProcessor {
  constructor(private readonly client: LlmClient) {
    super();
  }

  async generateJson(prompt: string): Promise<unknown> {
    return parseJsonObject(await this.client.generate(prompt));
  }
}
