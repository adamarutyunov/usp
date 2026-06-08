import {
  confirm,
  intro,
  isCancel,
  note,
  outro,
  select,
  text,
} from "@clack/prompts";
import pc from "yoctocolors";

import {
  findProjectConfig,
  loadGlobalConfig,
  loadProjectConfig,
  loadSocialAuthConfig,
  writeConfigFile,
  writeGlobalConfig,
  writeProjectConfig,
  writeSocialAuthConfig,
} from "../config/config.js";
import { BASE_GUIDANCE, DEFAULT_PLATFORM_PROMPTS } from "../llm/prompts.js";
import { PLATFORM_METADATA, PLATFORMS, isPlatform } from "../platforms.js";
import type { Platform, TargetRouting, UspConfig } from "../types.js";
import { SAMPLE_CONFIG } from "./init.js";
import { pickPostTargets, type PostTargetRow } from "./post-picker.js";
import { configureCredentials, deriveAccountName } from "./setup-credentials.js";
import { LLM_DEFAULTS, configureLlm } from "./setup-llm.js";
import { browseTargets, rowKey, type TreeRow } from "./target-tree.js";

const PLATFORM_ACCOUNT_NAMES = Object.fromEntries(
  PLATFORMS.map((platform) => [platform, PLATFORM_METADATA[platform].defaultAccount])
) as Record<Platform, string>;

const SOCIAL_PLATFORMS: Platform[] = [...PLATFORMS];

/** Thrown when a prompt is cancelled (Esc / Ctrl+C). Caught by the nearest menu loop, which treats it as "back". */
class SetupBack {}

function orBack<T>(value: T | symbol): T {
  if (isCancel(value)) {
    throw new SetupBack();
  }
  return value;
}

function ensureAccount(config: UspConfig, platform: Platform, name = PLATFORM_ACCOUNT_NAMES[platform]) {
  config.accounts ??= {};
  config.accounts[platform] ??= {};
  const accounts = config.accounts[platform] as Record<string, Record<string, unknown>>;
  accounts[name] ??= {};
  return accounts[name]!;
}

async function ensureProjectConfig() {
  const projectConfig = await findProjectConfig();
  if (projectConfig) {
    return projectConfig;
  }

  const created = await writeProjectConfig(SAMPLE_CONFIG, ".usp.yml");
  note(created, "Created project config");
  return created;
}

function applyValues(account: Record<string, unknown>, values: string[] = []) {
  for (const item of values) {
    const [key, ...rest] = item.split("=");
    if (!key || rest.length === 0) {
      throw new Error(`Invalid --value "${item}". Expected key=value.`);
    }
    account[key] = rest.join("=");
  }
}

async function writePlatformSocialAuth(
  platform: Platform,
  socialAuth: UspConfig
) {
  return writeSocialAuthConfig(`${platform}.yml`, {
    accounts: {
      [platform]: socialAuth.accounts?.[platform] ?? {},
    },
  } as UspConfig);
}

async function writeLlmAuth(config: UspConfig) {
  if (!config.llm) {
    return undefined;
  }
  return writeSocialAuthConfig("llm.yml", config);
}

function safeSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "account";
}

// The single routing field a platform needs per target. Platforms not listed have no
// routing — their targets are prompt-only variants of the account's one destination.
const ROUTING_FIELDS = Object.fromEntries(
  PLATFORMS.flatMap((platform) => {
    const routing = PLATFORM_METADATA[platform].routing;
    return routing ? [[platform, routing]] : [];
  })
) as Partial<Record<Platform, NonNullable<(typeof PLATFORM_METADATA)[Platform]["routing"]>>>;

type ProjectAccount = Record<string, unknown> & { targets?: Record<string, TargetRouting> };

function projectAccount(project: UspConfig, platform: Platform, accountName: string): ProjectAccount & { targets: Record<string, TargetRouting> } {
  project.accounts ??= {};
  const platformAccounts = ((project.accounts as Record<string, Record<string, ProjectAccount>>)[platform] ??= {});
  const account = (platformAccounts[accountName] ??= {});
  account.targets ??= {};
  return account as ProjectAccount & { targets: Record<string, TargetRouting> };
}

function fullTargetId(platform: Platform, accountName: string, targetName: string) {
  return `${platform}/${accountName}/${targetName}`;
}

/** Keep profiles.default pointing at every configured target so `--profile default` stays complete. */
function rebuildDefaultProfile(project: UspConfig) {
  const ids: string[] = [];
  for (const [platform, accounts] of Object.entries(project.accounts ?? {})) {
    for (const [accountName, account] of Object.entries((accounts ?? {}) as Record<string, ProjectAccount>)) {
      for (const targetName of Object.keys(account.targets ?? {})) {
        ids.push(fullTargetId(platform as Platform, accountName, targetName));
      }
    }
  }
  project.profiles ??= {};
  project.profiles.default = { targets: ids };
}

function accountsFor(config: UspConfig, platform: Platform) {
  return (config.accounts?.[platform] ?? {}) as Record<string, Record<string, unknown>>;
}

function llmStatus(project: UspConfig, socialAuth: UspConfig) {
  const llm = socialAuth.llm ?? project.llm;
  if (!llm?.provider) {
    return "not set";
  }

  const auth = llm.authToken ? "Claude token" : llm.apiKey ? "API key" : "auth pending";
  const model = llm.model ?? LLM_DEFAULTS[llm.provider].model;
  return `${llm.provider}, ${auth}, ${model}`;
}

const PLATFORM_INFO = Object.fromEntries(
  PLATFORMS.map((platform) => [
    platform,
    { label: PLATFORM_METADATA[platform].label, hint: PLATFORM_METADATA[platform].setupHint },
  ])
) as Record<Platform, { label: string; hint: string }>;

function targetsSummary(project: UspConfig, socialAuth: UspConfig) {
  const accounts = listAccounts(socialAuth, project);
  if (accounts.length === 0) {
    return "none yet";
  }
  const targets = accounts.reduce((sum, { platform, name }) => sum + Object.keys(readTargets(project, platform, name)).length, 0);
  return `${accounts.length} account${accounts.length === 1 ? "" : "s"}, ${targets} target${targets === 1 ? "" : "s"}`;
}

function deleteAccount(project: UspConfig, socialAuth: UspConfig, platform: Platform, accountName: string) {
  delete accountsFor(socialAuth, platform)[accountName];
  const projectAccounts = project.accounts?.[platform] as Record<string, unknown> | undefined;
  delete projectAccounts?.[accountName];
  rebuildDefaultProfile(project);
}

function readTargets(project: UspConfig, platform: Platform, accountName: string): Record<string, TargetRouting> {
  return ((project.accounts?.[platform] as Record<string, ProjectAccount> | undefined)?.[accountName]?.targets) ?? {};
}

function listAccounts(socialAuth: UspConfig, project: UspConfig) {
  const seen = new Map<string, { platform: Platform; name: string }>();
  for (const source of [socialAuth.accounts, project.accounts]) {
    for (const [platform, accounts] of Object.entries(source ?? {})) {
      for (const name of Object.keys(accounts ?? {})) {
        seen.set(`${platform}:${name}`, { platform: platform as Platform, name });
      }
    }
  }
  return [...seen.values()];
}

async function editTargetRouting(project: UspConfig, platform: Platform, accountName: string, targetName: string) {
  const routing = ROUTING_FIELDS[platform];
  if (!routing) {
    return;
  }
  const target = projectAccount(project, platform, accountName).targets[targetName]!;
  const current = (target as Record<string, unknown>)[routing.key];
  const value = orBack(
    await text({
      message: routing.label,
      placeholder: routing.placeholder,
      defaultValue: typeof current === "string" ? current : "",
      validate: routing.required ? (input) => (input?.trim() ? undefined : `${routing.label} is required.`) : undefined,
    })
  ).trim();
  if (value) {
    (target as Record<string, unknown>)[routing.key] = value;
  } else {
    delete (target as Record<string, unknown>)[routing.key];
  }
}

async function editTargetPrompt(project: UspConfig, platform: Platform, accountName: string, targetName: string) {
  const target = projectAccount(project, platform, accountName).targets[targetName]!;
  if (target.prompt) {
    note(target.prompt.text, `Current override (${target.prompt.mode})`);
  }
  const action = orBack(
    await select({
      message: "Target prompt",
      options: [
        { value: "append", label: "Append", hint: "Add after the platform rules" },
        { value: "replace", label: "Replace", hint: "Use only your text" },
        { value: "clear", label: "Clear override" },
        { value: "back", label: "Back" },
      ],
    })
  ) as "append" | "replace" | "clear" | "back";

  if (action === "back") return;
  if (action === "clear") {
    delete target.prompt;
    return;
  }
  const value = orBack(
    await text({
      message: action === "append" ? "Text to append" : "Replacement prompt",
      defaultValue: target.prompt?.mode === action ? target.prompt.text : undefined,
    })
  );
  target.prompt = { mode: action, text: value };
}

function buildTreeRows(socialAuth: UspConfig, project: UspConfig): TreeRow[] {
  const byPlatform = new Map<Platform, string[]>();
  for (const { platform, name } of listAccounts(socialAuth, project)) {
    byPlatform.set(platform, [...(byPlatform.get(platform) ?? []), name]);
  }

  const rows: TreeRow[] = [];
  for (const platform of SOCIAL_PLATFORMS) {
    const accounts = byPlatform.get(platform);
    if (!accounts?.length) {
      continue;
    }
    const platformPrompt = project.prompts?.[platform];
    rows.push({
      kind: "platform",
      platform,
      label: PLATFORM_INFO[platform].label,
      promptBadge: platformPrompt ? `prompt: ${platformPrompt.mode}` : undefined,
    });

    const routing = ROUTING_FIELDS[platform];
    for (const account of [...accounts].sort()) {
      const targets = Object.entries(readTargets(project, platform, account));
      rows.push({ kind: "account", platform, account, label: account, status: `${targets.length} target${targets.length === 1 ? "" : "s"}` });

      for (const [name, target] of targets) {
        const dest = routing ? (target as Record<string, unknown>)[routing.key] : undefined;
        const destText = typeof dest === "string" && dest.trim() ? dest : undefined;
        rows.push({
          kind: "target",
          platform,
          account,
          target: name,
          label: name,
          routing: destText,
          needsDestination: Boolean(routing?.required) && !destText,
          promptBadge: target.prompt ? target.prompt.mode : undefined,
        });
      }
    }
  }
  rows.push({ kind: "add-account" });
  return rows;
}

async function editPlatformPrompt(project: UspConfig, platform: Platform) {
  note(DEFAULT_PLATFORM_PROMPTS[platform], `${PLATFORM_INFO[platform].label} rules`);
  const existing = project.prompts?.[platform];
  if (existing) {
    note(existing.text, `Override (${existing.mode})`);
  }
  const action = orBack(
    await select({
      message: `${PLATFORM_INFO[platform].label} prompt`,
      options: [
        { value: "append", label: "Append", hint: "Add after the platform rules" },
        { value: "replace", label: "Replace", hint: "Use only your text" },
        { value: "clear", label: "Clear override" },
        { value: "back", label: "Back" },
      ],
    })
  ) as "append" | "replace" | "clear" | "back";

  if (action === "back") return;
  project.prompts ??= {};
  if (action === "clear") {
    delete project.prompts[platform];
    note("Reverted to default rules.", "Saved");
    return;
  }
  const value = orBack(
    await text({
      message: action === "append" ? "Text to append" : "Replacement prompt",
      defaultValue: existing?.mode === action ? existing.text : undefined,
    })
  );
  project.prompts[platform] = { mode: action, text: value };
  note("Prompt saved.", "Saved");
}

async function addAccountFlow(socialAuth: UspConfig, project: UspConfig, projectPath: string, platform?: Platform) {
  let chosen = platform;
  if (!chosen) {
    const pick = orBack(
      await select({
        message: "Platform for the new account",
        options: [
          ...SOCIAL_PLATFORMS.map((item) => ({ value: item, label: PLATFORM_INFO[item].label, hint: PLATFORM_INFO[item].hint })),
          { value: "back", label: "Back" },
        ],
      })
    ) as Platform | "back";
    if (pick === "back") return;
    chosen = pick;
  }

  // Gather everything into detached objects and commit only once every prompt is answered,
  // so escaping mid-setup never leaves an abandoned account or target behind.
  const account: Record<string, unknown> = {};
  await configureCredentials(chosen, account, orBack);

  const derived = safeSegment((await deriveAccountName(chosen, account)) ?? chosen);
  if (chosen === "threads" && derived && derived !== "threads") {
    account.username = derived;
  }
  const name = safeSegment(
    orBack(await text({ message: "Account name", defaultValue: derived, placeholder: derived }))
  );

  // Routing platforms need a destination, so the first target is created right away with one.
  // Other platforms post to the account's own feed, so a `default` target is enough.
  const routing = ROUTING_FIELDS[chosen];
  let targetName = "default";
  const targetRouting: TargetRouting = {};
  if (routing) {
    targetName = safeSegment(orBack(await text({ message: "Target name", placeholder: "channel" })));
    const value = orBack(
      await text({
        message: routing.label,
        placeholder: routing.placeholder,
        validate: routing.required ? (input) => (input?.trim() ? undefined : `${routing.label} is required.`) : undefined,
      })
    ).trim();
    if (value) (targetRouting as Record<string, unknown>)[routing.key] = value;
  }

  accountsFor(socialAuth, chosen)[name] = account;
  projectAccount(project, chosen, name).targets[targetName] = targetRouting;
  rebuildDefaultProfile(project);
  await writePlatformSocialAuth(chosen, socialAuth);
  await writeConfigFile(projectPath, project);
  note(`${PLATFORM_INFO[chosen].label} · ${name} saved.`, "Saved");
}

async function addTargetFlow(project: UspConfig, projectPath: string, platform: Platform, accountName: string) {
  const routing = ROUTING_FIELDS[platform];
  const name = safeSegment(
    orBack(await text({ message: "Target name", placeholder: routing ? "channel" : "language or variant" }))
  );

  const target: TargetRouting = {};
  if (routing) {
    const value = orBack(
      await text({
        message: routing.label,
        placeholder: routing.placeholder,
        validate: routing.required ? (input) => (input?.trim() ? undefined : `${routing.label} is required.`) : undefined,
      })
    ).trim();
    if (value) {
      (target as Record<string, unknown>)[routing.key] = value;
    }
  }

  projectAccount(project, platform, accountName).targets[name] = target;
  rebuildDefaultProfile(project);
  await writeConfigFile(projectPath, project);
}

async function manageTargetNode(socialAuth: UspConfig, project: UspConfig, projectPath: string, platform: Platform, account: string, targetName: string) {
  const routing = ROUTING_FIELDS[platform];
  const action = orBack(
    await select({
      message: fullTargetId(platform, account, targetName),
      options: [
        { value: "prompt", label: "Edit prompt" },
        ...(routing ? [{ value: "destination", label: `Set ${routing.label.toLowerCase()}` }] : []),
        { value: "delete", label: "Delete target" },
        { value: "back", label: "Back" },
      ],
    })
  ) as "prompt" | "destination" | "delete" | "back";

  if (action === "back") return;
  if (action === "prompt") {
    await editTargetPrompt(project, platform, account, targetName);
  } else if (action === "destination") {
    await editTargetRouting(project, platform, account, targetName);
    rebuildDefaultProfile(project);
  } else if (action === "delete") {
    const ok = await confirm({ message: `Delete target ${fullTargetId(platform, account, targetName)}?`, initialValue: false });
    if (isCancel(ok) || !ok) return;
    delete projectAccount(project, platform, account).targets[targetName];
    rebuildDefaultProfile(project);
    note("Target deleted.", "Deleted");
  }
  await writeConfigFile(projectPath, project);
}

async function manageAccountNode(socialAuth: UspConfig, project: UspConfig, projectPath: string, platform: Platform, account: string) {
  const action = orBack(
    await select({
      message: `${PLATFORM_INFO[platform].label} · ${account}`,
      options: [
        { value: "add-target", label: "Add target" },
        { value: "credentials", label: "Edit credentials" },
        { value: "delete", label: "Delete account" },
        { value: "back", label: "Back" },
      ],
    })
  ) as "add-target" | "credentials" | "delete" | "back";

  if (action === "back") return;
  if (action === "add-target") {
    await addTargetFlow(project, projectPath, platform, account);
  } else if (action === "credentials") {
    const edited = { ...ensureAccount(socialAuth, platform, account) };
    await configureCredentials(platform, edited, orBack); // commit only if every prompt is answered
    accountsFor(socialAuth, platform)[account] = edited;
    await writePlatformSocialAuth(platform, socialAuth);
    note("Credentials updated.", "Saved");
  } else if (action === "delete") {
    const ok = await confirm({ message: `Delete account ${PLATFORM_INFO[platform].label} · ${account} and its targets?`, initialValue: false });
    if (isCancel(ok) || !ok) return;
    deleteAccount(project, socialAuth, platform, account);
    await writePlatformSocialAuth(platform, socialAuth);
    await writeConfigFile(projectPath, project);
    note("Account deleted.", "Deleted");
  }
}

async function managePlatformNode(socialAuth: UspConfig, project: UspConfig, projectPath: string, platform: Platform) {
  const action = orBack(
    await select({
      message: PLATFORM_INFO[platform].label,
      options: [
        { value: "prompt", label: "Edit platform prompt" },
        { value: "add-account", label: "Add account" },
        { value: "back", label: "Back" },
      ],
    })
  ) as "prompt" | "add-account" | "back";

  if (action === "back") return;
  if (action === "prompt") {
    await editPlatformPrompt(project, platform);
    await writeConfigFile(projectPath, project);
  } else if (action === "add-account") {
    await addAccountFlow(socialAuth, project, projectPath, platform);
  }
}

async function dispatchTreeSelection(row: TreeRow, socialAuth: UspConfig, project: UspConfig, projectPath: string) {
  if (row.kind === "add-account") {
    await addAccountFlow(socialAuth, project, projectPath);
  } else if (row.kind === "platform") {
    await managePlatformNode(socialAuth, project, projectPath, row.platform);
  } else if (row.kind === "account") {
    await manageAccountNode(socialAuth, project, projectPath, row.platform, row.account);
  } else {
    await manageTargetNode(socialAuth, project, projectPath, row.platform, row.account, row.target);
  }
}

async function configureTargets(socialAuth: UspConfig, project: UspConfig, projectPath: string) {
  let selectedKey: string | undefined;
  for (;;) {
    const action = await browseTargets(buildTreeRows(socialAuth, project), { selectedKey });
    if (action.kind === "done") return;
    selectedKey = rowKey(action.row); // re-enter on the same node after the sub-menu closes
    try {
      await dispatchTreeSelection(action.row, socialAuth, project, projectPath);
    } catch (error) {
      if (error instanceof SetupBack) continue;
      throw error;
    }
  }
}

async function configureGlobalPrompt() {
  const global = await loadGlobalConfig();
  note(BASE_GUIDANCE, "Base prompt (fixed)");
  if (global.globalPrompt) {
    note(global.globalPrompt, "Your global rules");
  }
  const action = orBack(
    await select({
      message: "Global prompt (appended to every prompt)",
      options: [
        { value: "edit", label: global.globalPrompt ? "Edit global rules" : "Add global rules" },
        ...(global.globalPrompt ? [{ value: "clear", label: "Clear" }] : []),
        { value: "back", label: "Back" },
      ],
    })
  ) as "edit" | "clear" | "back";

  if (action === "back") return;
  if (action === "clear") {
    delete global.globalPrompt;
    await writeGlobalConfig(global);
    note("Cleared.", "Saved");
    return;
  }
  const value = orBack(
    await text({
      message: "Global rules (appended to every prompt)",
      defaultValue: global.globalPrompt,
      placeholder: "e.g. Always write in British English.",
    })
  ).trim();
  if (value) {
    global.globalPrompt = value;
  } else {
    delete global.globalPrompt;
  }
  await writeGlobalConfig(global);
  note("Global prompt saved.", "Saved");
}

async function configurePostingDefaults(project: UspConfig) {
  const targets = Object.entries(project.targets ?? {});
  if (targets.length === 0) {
    note("No targets configured yet. Add a target first.", "Default posting");
    return;
  }

  const global = await loadGlobalConfig();
  const rows: PostTargetRow[] = targets.map(([id, target]) => ({
    id,
    platform: target.platform,
    account: target.account,
    mode: global.postingDefaults?.[id] ?? "off",
  }));

  const selection = await pickPostTargets(rows, { message: "Default posting per target" });
  if (selection === null) {
    return;
  }

  global.postingDefaults = Object.fromEntries(selection.map((row) => [row.id, row.mode]));
  await writeGlobalConfig(global);
  note("Default posting saved.", "Saved");
}

async function runInteractiveSetup() {
  intro("usp setup");
  const projectPath = await ensureProjectConfig();
  const loadedProject = await loadProjectConfig(projectPath);
  if (!loadedProject) {
    throw new Error(`Could not load project config at ${projectPath}.`);
  }

  const socialAuth = await loadSocialAuthConfig();
  const project = loadedProject.config;

  let lastSection: string | undefined;
  for (;;) {
    let section: "llm" | "targets" | "prompts" | "posting" | "exit";
    try {
      section = orBack(
        await select({
          message: "Setup menu",
          initialValue: lastSection, // keep the cursor where it was after returning from a section
          options: [
            { value: "targets", label: "Targets", hint: targetsSummary(project, socialAuth) },
            { value: "llm", label: "LLM provider", hint: llmStatus(project, socialAuth) },
            { value: "prompts", label: "Global prompt", hint: "global rules appended to every prompt" },
            { value: "posting", label: "Default posting", hint: "per-target defaults for the publish picker" },
            { value: "exit", label: "Exit" },
          ],
        })
      ) as "llm" | "targets" | "prompts" | "posting" | "exit";
      lastSection = section;
    } catch (error) {
      // Cancelling the top-level menu exits the wizard (saving first).
      if (error instanceof SetupBack) {
        section = "exit";
      } else {
        throw error;
      }
    }

    if (section === "exit") {
      await writeLlmAuth({ llm: socialAuth.llm });
      await writeConfigFile(loadedProject.path, project);
      outro(`Social auth is saved under ~/.config/usp/social-auth\nProject config is saved at ${loadedProject.path}`);
      return;
    }

    // Cancelling anything inside a section drops back to this menu.
    try {
      if (section === "llm") {
        await configureLlm(project, socialAuth, orBack);
        await writeLlmAuth({ llm: socialAuth.llm });
        await writeConfigFile(loadedProject.path, project);
        note("LLM settings saved. Pick another section or Exit.", "Saved");
        continue;
      }

      if (section === "prompts") {
        await configureGlobalPrompt();
        continue;
      }

      if (section === "posting") {
        await configurePostingDefaults(project);
        continue;
      }

      await configureTargets(socialAuth, project, loadedProject.path);
    } catch (error) {
      if (error instanceof SetupBack) continue;
      throw error;
    }
  }
}

export async function setupCommand(options: { platform?: Platform; account?: string; value?: string[] } = {}) {
  if (options.platform) {
    await ensureProjectConfig();
    if (!isPlatform(options.platform)) {
      throw new Error(`Unsupported platform: ${options.platform}`);
    }
    const config = await loadSocialAuthConfig();
    const name = options.account ?? PLATFORM_ACCOUNT_NAMES[options.platform];
    const account = ensureAccount(config, options.platform, name);
    applyValues(account, options.value);
    const path = await writePlatformSocialAuth(options.platform, config);
    console.log(`Saved ${options.platform}.${name} credentials to ${path}`);
    return;
  }

  await runInteractiveSetup();
}
