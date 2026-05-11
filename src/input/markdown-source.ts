import { readMarkdownInput, readMarkdownText } from "../content/markdown.js";
import { InputSource, type PipelineInput } from "../pipeline/contracts.js";

export class MarkdownFileInputSource extends InputSource {
  constructor(private readonly filePath: string) {
    super();
  }

  read(): Promise<PipelineInput> {
    return readMarkdownInput(this.filePath);
  }
}

export class MarkdownTextInputSource extends InputSource {
  constructor(
    private readonly text: string,
    private readonly label = "<text>"
  ) {
    super();
  }

  read(): Promise<PipelineInput> {
    return readMarkdownText(this.text, this.label, process.cwd());
  }
}

export class StdinMarkdownInputSource extends InputSource {
  async read(): Promise<PipelineInput> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return readMarkdownText(Buffer.concat(chunks).toString("utf8"), "<stdin>", process.cwd());
  }
}
