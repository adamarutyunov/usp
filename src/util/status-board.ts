import pc from "yoctocolors";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_INTERVAL_MS = 80;

type Paint = (text: string) => string;

type ActiveLine = {
	id: string;
	text: string;
	paint: Paint;
};

/**
 * Live multi-line progress for concurrent jobs: each job owns one line that
 * animates in place until it finishes, then it is retired as a permanent line
 * above the live block. On non-TTY streams every transition appends a plain
 * line instead, so CI logs stay readable.
 */
export class StatusBoard {
	private active: ActiveLine[] = [];
	private renderedLines = 0;
	private frame = 0;
	private timer: ReturnType<typeof setInterval> | undefined;
	private cursorHidden = false;
	private readonly tty: boolean;

	constructor(private readonly stream: NodeJS.WriteStream = process.stdout) {
		this.tty = Boolean(stream.isTTY);
	}

	start(id: string, text: string, paint: Paint = pc.dim) {
		if (!this.tty) {
			this.stream.write(`${paint(text)}\n`);
			return;
		}
		this.clear();
		this.active = this.active.filter((line) => line.id !== id);
		this.active.push({ id, text, paint });
		this.ensureTimer();
		this.render();
	}

	update(id: string, text: string, paint?: Paint) {
		const line = this.active.find((entry) => entry.id === id);
		if (!line) {
			this.start(id, text, paint);
			return;
		}
		line.text = text;
		if (paint) {
			line.paint = paint;
		}
		if (this.tty) {
			this.clear();
			this.render();
		} else {
			this.stream.write(`${line.paint(text)}\n`);
		}
	}

	succeed(
		id: string,
		text: string,
		details: string[] = [],
		paint: Paint = pc.green,
	) {
		this.finish(
			id,
			paint(`✅ ${text}`),
			details.map((line) => pc.dim(line)),
		);
	}

	fail(id: string, text: string, ...detailLines: string[]) {
		this.finish(id, pc.red(`❌ ${text}`), detailLines);
	}

	/** Print permanent lines above the live block (post URLs, warnings, text dumps). */
	log(...lines: string[]) {
		if (!this.tty) {
			for (const line of lines) {
				this.stream.write(`${line}\n`);
			}
			return;
		}
		this.clear();
		for (const line of lines) {
			this.stream.write(`${line}\n`);
		}
		this.render();
	}

	stop() {
		this.stopTimer();
		if (this.tty) {
			this.clear();
			this.active = [];
			this.showCursor();
		}
	}

	private finish(id: string, line: string, detailLines: string[]) {
		if (!this.tty) {
			this.stream.write(`${line}\n`);
			for (const detail of detailLines) {
				this.stream.write(`${detail}\n`);
			}
			return;
		}
		this.clear();
		this.active = this.active.filter((entry) => entry.id !== id);
		this.stream.write(`${line}\n`);
		for (const detail of detailLines) {
			this.stream.write(`${detail}\n`);
		}
		if (this.active.length === 0) {
			this.stopTimer();
			this.showCursor();
		}
		this.render();
	}

	private ensureTimer() {
		if (this.timer || !this.tty) {
			return;
		}
		this.hideCursor();
		this.timer = setInterval(() => {
			this.frame += 1;
			this.clear();
			this.render();
		}, FRAME_INTERVAL_MS);
		// Don't keep the process alive just for the animation.
		this.timer.unref?.();
	}

	private stopTimer() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	private render() {
		if (!this.tty || this.active.length === 0) {
			this.renderedLines = 0;
			return;
		}
		const columns = this.stream.columns ?? 80;
		const frameChar = FRAMES[this.frame % FRAMES.length];
		const block = this.active
			.map((line) => {
				const text =
					line.text.length > columns - 3
						? `${line.text.slice(0, columns - 4)}…`
						: line.text;
				return line.paint(`${frameChar} ${text}`);
			})
			.join("\n");
		this.stream.write(`${block}\n`);
		this.renderedLines = this.active.length;
	}

	private clear() {
		if (!this.tty || this.renderedLines === 0) {
			return;
		}
		this.stream.write(`\x1b[${this.renderedLines}A\x1b[J`);
		this.renderedLines = 0;
	}

	private hideCursor() {
		if (!this.cursorHidden) {
			this.stream.write("\x1b[?25l");
			this.cursorHidden = true;
		}
	}

	private showCursor() {
		if (this.cursorHidden) {
			this.stream.write("\x1b[?25h");
			this.cursorHidden = false;
		}
	}
}
