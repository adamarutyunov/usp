import { note, password, select, text } from "@clack/prompts";
import type { LlmProvider, UspConfig } from "../types.js";
import type { OrBack } from "./setup-credentials.js";

export const LLM_DEFAULTS: Record<LlmProvider, { model: string; keyUrl: string; label: string }> = {
  gemini: {
    model: "gemini-2.5-flash-lite",
    keyUrl: "https://aistudio.google.com/app/apikey",
    label: "Gemini",
  },
  openai: {
    model: "gpt-5.4-mini",
    keyUrl: "https://platform.openai.com/api-keys",
    label: "OpenAI",
  },
  anthropic: {
    model: "claude-sonnet-4-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
    label: "Anthropic",
  },
};

const MODEL_SUGGESTIONS: Record<LlmProvider, string[]> = {
  anthropic: ["claude-opus-4-8", "claude-sonnet-4-5", "claude-haiku-4-5"],
  openai: ["gpt-5.4", "gpt-5.4-mini"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
};

async function authenticateLlm(
  provider: LlmProvider,
  model: string,
  project: UspConfig,
  socialAuth: UspConfig,
  orBack: OrBack
) {
  const defaults = LLM_DEFAULTS[provider];

  if (provider === "anthropic") {
    note(
      [
        "API key path: https://console.anthropic.com/settings/keys",
        "Claude Code token path: run `claude setup-token`, then paste the result here.",
      ].join("\n"),
      "Anthropic auth"
    );
    const mode = orBack(
      await select({
        message: "How should usp authenticate Anthropic?",
        initialValue: "auth-paste",
        options: [
          { value: "auth-paste", label: "Paste Claude setup-token result", hint: "Saved under social-auth" },
          { value: "api-paste", label: "Paste API key now", hint: "Saved under social-auth" },
        ],
      })
    ) as "auth-paste" | "api-paste";

    project.llm = { provider, model };
    socialAuth.llm =
      mode === "auth-paste"
        ? { provider, model, authToken: orBack(await password({ message: "Claude setup-token result" })) }
        : { provider, model, apiKey: orBack(await password({ message: "Anthropic API key" })) };
    return;
  }

  note(`Create or copy an API key here: ${defaults.keyUrl}`, `${defaults.label} key`);
  project.llm = { provider, model };
  socialAuth.llm = {
    provider,
    model,
    apiKey: orBack(await password({ message: `${defaults.label} API key` })),
  };
}

async function selectLlmModel(provider: LlmProvider, currentModel: string, orBack: OrBack) {
  const suggestions = MODEL_SUGGESTIONS[provider];
  const choice = orBack(
    await select({
      message: "Model",
      initialValue: currentModel,
      options: [
        ...suggestions.map((id) => ({ value: id, label: id, ...(id === currentModel ? { hint: "current" } : {}) })),
        ...(suggestions.includes(currentModel) ? [] : [{ value: currentModel, label: currentModel, hint: "current" }]),
        { value: "__custom", label: "Custom...", hint: "Enter a model id" },
      ],
    })
  ) as string;

  if (choice !== "__custom") {
    return choice;
  }
  const custom = orBack(
    await text({ message: "Model id", defaultValue: currentModel, placeholder: currentModel })
  );
  return custom.trim() || currentModel;
}

export async function configureLlm(project: UspConfig, socialAuth: UspConfig, orBack: OrBack) {
  const authedProvider = socialAuth.llm?.provider;
  const provider = orBack(
    await select({
      message: "Choose your LLM provider",
      initialValue: authedProvider ?? project.llm?.provider ?? "anthropic",
      options: [
        { value: "anthropic", label: "Anthropic", hint: "Claude, recommended" },
        { value: "openai", label: "OpenAI", hint: "GPT models" },
        { value: "gemini", label: "Gemini", hint: "Google AI Studio" },
      ],
    })
  ) as LlmProvider;

  const currentModel =
    (socialAuth.llm?.provider === provider && socialAuth.llm.model) ||
    (project.llm?.provider === provider && project.llm.model) ||
    LLM_DEFAULTS[provider].model;

  if (provider !== authedProvider) {
    await authenticateLlm(provider, currentModel, project, socialAuth, orBack);
    return;
  }

  const authLabel = socialAuth.llm?.authToken ? "Claude token" : socialAuth.llm?.apiKey ? "API key" : "auth pending";
  const action = orBack(
    await select({
      message: `${LLM_DEFAULTS[provider].label} setup`,
      options: [
        { value: "reauth", label: "Reauthenticate", hint: authLabel },
        { value: "model", label: "Change model", hint: currentModel },
        { value: "back", label: "Back" },
      ],
    })
  ) as "reauth" | "model" | "back";

  if (action === "back") {
    return;
  }
  if (action === "model") {
    const model = await selectLlmModel(provider, currentModel, orBack);
    project.llm = { provider, model };
    socialAuth.llm = { ...(socialAuth.llm ?? {}), provider, model };
    note(`Model set to ${model}.`, "Saved");
    return;
  }

  await authenticateLlm(provider, currentModel, project, socialAuth, orBack);
}
