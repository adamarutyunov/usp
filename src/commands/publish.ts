import { cancel, confirm, isCancel, select } from "@clack/prompts";
import pc from "yoctocolors";
import {
	loadConfig,
	loadGlobalConfig,
	writeGlobalConfig,
} from "../config/config.js";
import {
	MarkdownFileInputSource,
	MarkdownTextInputSource,
	StdinMarkdownInputSource,
} from "../input/markdown-source.js";
import { createLlmClient } from "../llm/client.js";
import { JsonLlmProcessor } from "../llm/processor.js";
import type { TargetRef } from "../pipeline/contracts.js";
import { formatError, PublishPipeline } from "../pipeline/pipeline.js";
import { LlmPlatformPlanner } from "../pipeline/planner.js";
import { AdapterPoster } from "../posting/poster.js";
import { PreviewStore } from "../preview/store.js";
import {
	ConfigPromptProvider,
	parsePromptOverride,
} from "../prompt/provider.js";
import type { PostMode, PublishTargetResult } from "../types.js";
import { platformName, printError } from "../util/display.js";
import { StatusBoard } from "../util/status-board.js";
import { type PostTargetRow, pickPostTargets } from "./post-picker.js";
import {
	filterReadyTargets,
	resolveInitialPostMode,
	resolveTargets,
} from "./targets.js";

function createPipeline(
	file: string | undefined,
	options: {
		prompt?: string[];
		input?: string;
		inputText?: string;
		stdin?: boolean;
	},
	config: Awaited<ReturnType<typeof loadConfig>>,
) {
	const inlineInput = options.inputText ?? options.input;
	if (!options.stdin && !inlineInput && !file) {
		throw new Error("Provide a Markdown file, --input, or --stdin.");
	}
	const input = options.stdin
		? new StdinMarkdownInputSource()
		: inlineInput
			? new MarkdownTextInputSource(inlineInput)
			: new MarkdownFileInputSource(file ?? "");
	const llm = new JsonLlmProcessor(createLlmClient(config.llm));
	const prompts = new ConfigPromptProvider(
		(options.prompt ?? []).map(parsePromptOverride),
	);
	const planner = new LlmPlatformPlanner(prompts, llm);
	return new PublishPipeline(input, planner, new AdapterPoster());
}

function assertNotCancel<T>(value: T | symbol): T {
	if (isCancel(value)) {
		cancel("Publish cancelled.");
		process.exit(0);
	}
	return value;
}

// Targets are processed concurrently; each one owns a line on the StatusBoard
// that animates in place and is retired (✅/❌) when the target finishes.
type HookTarget = {
	id: string;
	config: { platform: Parameters<typeof platformName>[0] };
	postMode?: PostMode;
};

function label(target: HookTarget) {
	return `${platformName(target.config.platform)} (${target.id})`;
}

function isAsIs(target: HookTarget) {
	return target.postMode === "as-is";
}

function createHumanHooks(mode: "publish" | "preview") {
	const board = new StatusBoard();
	const hooks = {
		onPreviewDirectory(dir: string) {
			board.log(pc.dim(`Preview folder: ${dir}`));
		},
		onPreviewReuse(target: HookTarget) {
			if (mode === "preview") {
				board.succeed(
					target.id,
					`Loaded existing preview for ${label(target)}`,
				);
			}
		},
		onPreviewWrite(target: HookTarget, filePath: string) {
			// Writing the file is the "done" signal for a preview; show it as success.
			if (mode === "preview") {
				const verb = isAsIs(target)
					? "Copied text as-is"
					: "Generated post text";
				board.succeed(
					target.id,
					`${verb} for ${label(target)}`,
					[`   ${filePath}`],
					isAsIs(target) ? pc.yellow : pc.green,
				);
			}
		},
		onPrepareStart(target: HookTarget) {
			if (isAsIs(target)) {
				board.start(
					target.id,
					`Copying text as-is for ${label(target)}…`,
					pc.yellow,
				);
				return;
			}
			const verb =
				mode === "preview" ? "Generating post text for" : "Preparing text for";
			board.start(target.id, `${verb} ${label(target)}…`);
		},
		onPrepareError(target: HookTarget, error: unknown) {
			board.fail(
				target.id,
				`Failed preparing text for ${label(target)}: ${formatError(error)}`,
			);
		},
		onPostStart(target: HookTarget) {
			board.update(target.id, `Posting to ${label(target)}…`, pc.dim);
		},
		onPostSuccess(target: HookTarget) {
			board.succeed(target.id, `Posted to ${label(target)}`);
		},
		onPostError(target: HookTarget, error: unknown) {
			// The final summary reports the error and any partially published posts.
			board.fail(
				target.id,
				`Failed posting to ${label(target)}: ${formatError(error)}`,
			);
		},
	};
	return { board, hooks };
}

function printPublishSummary(results: PublishTargetResult[]) {
	console.log("");
	for (const result of results.filter((entry) => entry.ok)) {
		console.log(
			pc.green(`✅ ${platformName(result.platform)} (${result.target})`),
		);
		for (const post of result.posts) {
			if (post.url ?? post.id) {
				console.log(`   ${post.url ?? post.id}`);
			}
		}
		for (const warning of result.warnings ?? []) {
			console.log(pc.yellow(`   ${warning}`));
		}
	}
	for (const result of results.filter((entry) => entry.ok === false)) {
		console.log(
			pc.red(
				`❌ ${platformName(result.platform)} (${result.target}): ${result.error}`,
			),
		);
		if (result.posts.length > 0) {
			console.log(
				pc.yellow(
					`   ${result.posts.length} post(s) in this thread already went live before the failure — ` +
						`re-running ${result.target} would duplicate them:`,
				),
			);
			for (const post of result.posts) {
				if (post.url ?? post.id) {
					console.log(`   ${post.url ?? post.id}`);
				}
			}
		}
	}
}

export async function planCommand(
	file: string | undefined,
	options: {
		config?: string;
		profile?: string;
		target?: string[];
		set?: string[];
		prompt?: string[];
		input?: string;
		inputText?: string;
		stdin?: boolean;
	},
) {
	const config = await loadConfig({
		configPath: options.config,
		overrides: options.set,
	});
	const targets = resolveTargets(config, {
		profile: options.profile,
		targets: options.target,
	});
	const { ready: locallyReady, skipped: localSkipped } = filterReadyTargets(
		config,
		targets,
		{
			explicitTargets: Boolean(options.target?.length),
		},
	);
	for (const target of localSkipped) {
		console.warn(`Skipping ${target.id}: ${target.reason}`);
	}
	if (locallyReady.length === 0) {
		throw new Error(
			"No configured targets to plan for. Run `usp setup` or pass a configured --target.",
		);
	}
	const pipeline = createPipeline(file, options, config);
	const { plan } = await pipeline.planOnly({
		config,
		targets: locallyReady,
	});
	console.log(JSON.stringify(plan, null, 2));
}

type PublishOptions = {
	config?: string;
	profile?: string;
	target?: string[];
	set?: string[];
	prompt?: string[];
	input?: string;
	inputText?: string;
	stdin?: boolean;
};

async function savePostingDefaults(rows: PostTargetRow[]) {
	const global = await loadGlobalConfig();
	global.postingDefaults = Object.fromEntries(
		rows.map((row) => [row.id, row.mode]),
	);
	await writeGlobalConfig(global);
}

async function resolvePublishTargets(
	config: Awaited<ReturnType<typeof loadConfig>>,
	options: PublishOptions,
	mode: "publish" | "preview",
): Promise<TargetRef[]> {
	const interactive =
		!options.target?.length && !options.stdin && Boolean(process.stdout.isTTY);

	if (interactive) {
		const allTargets = Object.entries(config.targets ?? {}).map(
			([id, targetConfig]) => ({ id, config: targetConfig }),
		);
		if (allTargets.length === 0) {
			throw new Error("No targets configured. Run `usp setup`.");
		}
		const { ready } = filterReadyTargets(config, allTargets);
		if (ready.length === 0) {
			throw new Error(
				"No configured targets are ready to publish to. Run `usp setup`.",
			);
		}
		const hasSavedDefaults =
			Object.keys(config.postingDefaults ?? {}).length > 0;
		const rows: PostTargetRow[] = ready.map((target) => ({
			id: target.id,
			platform: target.config.platform,
			account: target.config.account,
			mode: resolveInitialPostMode(config, target.id),
		}));
		const selection = await pickPostTargets(rows);
		if (selection === null) {
			cancel("Publish cancelled.");
			process.exit(0);
		}
		const chosen = selection.filter((row) => row.mode !== "off");
		if (chosen.length === 0) {
			throw new Error("No targets selected.");
		}

		if (mode === "publish" && !hasSavedDefaults) {
			const save = await confirm({
				message: "Set this target configuration as default?",
				initialValue: false,
			});
			if (isCancel(save)) {
				cancel("Publish cancelled.");
				process.exit(0);
			}
			if (save) {
				await savePostingDefaults(selection);
			}
		}

		const configById = new Map(
			ready.map((target) => [target.id, target.config]),
		);
		return chosen.map((row) => ({
			id: row.id,
			config: configById.get(row.id)!,
			postMode: row.mode,
		}));
	}

	const targets = resolveTargets(config, {
		profile: options.profile,
		targets: options.target,
	});
	const { ready, skipped } = filterReadyTargets(config, targets, {
		explicitTargets: Boolean(options.target?.length),
	});
	for (const target of skipped) {
		console.warn(`Skipping ${target.id}: ${target.reason}`);
	}
	if (ready.length === 0) {
		throw new Error(
			"No configured targets to publish to. Run `usp setup` or pass a configured --target.",
		);
	}
	return ready.map((target) => ({ ...target, postMode: "llm" as PostMode }));
}

async function runPublishFlow(
	file: string | undefined,
	options: PublishOptions,
	mode: "publish" | "preview",
) {
	const config = await loadConfig({
		configPath: options.config,
		overrides: options.set,
	});
	const locallyReady = await resolvePublishTargets(config, options, mode);
	const pipeline = createPipeline(file, options, config);
	const previewStore = new PreviewStore();
	const { board, hooks } = createHumanHooks(mode);
	const { results } = await pipeline.publish({
		config,
		targets: locallyReady,
		dryRun: false,
		preview: {
			store: previewStore,
			previewOnly: mode === "preview",
			async onExistingDirectory(dir) {
				if (mode === "preview") {
					// `usp preview` regenerates; just confirm before clobbering the existing folder.
					const overwrite = await confirm({
						message: `A preview already exists at ${dir}. Overwrite it?`,
						initialValue: true,
					});
					if (isCancel(overwrite) || !overwrite) {
						cancel("Preview cancelled.");
						process.exit(0);
					}
					return "regenerate";
				}
				return assertNotCancel(
					await select({
						message: `A preview already exists for this input at ${dir}.`,
						options: [
							{
								value: "reuse",
								label: "Reuse preview text",
								hint: "Load existing target files and generate only missing ones",
							},
							{
								value: "regenerate",
								label: "Regenerate text",
								hint: "Replace preview files with fresh LLM output",
							},
						],
					}),
				);
			},
		},
		hooks,
	});
	board.stop();

	if (mode === "preview") {
		const failed = results.filter((result) => result.ok === false);
		for (const result of failed) {
			printError(`${result.target}: ${result.error}`);
		}
		const publishCmd = file ? `usp publish ${file}` : "usp publish";
		console.log("");
		console.log(pc.white(`Edit the files, then run \`${publishCmd}\` to post.`));
		return;
	}

	printPublishSummary(results);
}

export async function publishCommand(
	file: string | undefined,
	options: PublishOptions,
) {
	await runPublishFlow(file, options, "publish");
}

export async function previewCommand(
	file: string | undefined,
	options: PublishOptions,
) {
	await runPublishFlow(file, options, "preview");
}
