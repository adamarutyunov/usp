import { loadAllSourceMedia, readMarkdownInput, readMarkdownText } from "../content/markdown.js";
import { InputSource, type PipelineInput } from "../pipeline/contracts.js";
import type { SourceMedia } from "../types.js";

abstract class MarkdownInputSource extends InputSource {
  loadMedia(media: SourceMedia[]): Promise<SourceMedia[]> {
    return loadAllSourceMedia(media);
  }
}

export class MarkdownFileInputSource extends MarkdownInputSource {
  constructor(private readonly filePath: string) {
    super();
  }

  read(): Promise<PipelineInput> {
    return readMarkdownInput(this.filePath);
  }
}

export class MarkdownTextInputSource extends MarkdownInputSource {
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

export class StdinMarkdownInputSource extends MarkdownInputSource {
  async read(): Promise<PipelineInput> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return readMarkdownText(Buffer.concat(chunks).toString("utf8"), "<stdin>", process.cwd());
  }
}
