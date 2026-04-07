"use client";

import { useEffect, useState } from "react";

type PlatformLlmModel = {
  id: string;
  code: string;
  displayName: string;
  provider: "OPENAI" | "ANTHROPIC" | "GOOGLE" | "DEEPSEEK" | "GROQ";
  contextWindow: number;
  maxOutputTokens: number | null;
  supportsVision: boolean;
  supportsStructuredOutputs: boolean;
  supportsReasoning: boolean;
  isActive: boolean;
  isDefault: boolean;
};

type PlatformLlmProfile = {
  id: string;
  key: string;
  displayName: string;
  description: string | null;
  primaryModelId: string;
  fallbackModelIds: string[];
  defaultMaxTokensOut: number | null;
  defaultTemperature: number | null;
  defaultReasoningEffort: string | null;
  supportsStructuredOutputs: boolean;
  usageTags: string[];
  isActive: boolean;
  isDefault: boolean;
  primaryModel: {
    id: string;
    code: string;
    displayName: string;
    provider: string;
  };
};

type ProviderHealth = {
  providerCode: string;
  configured: boolean;
  healthy: boolean;
};

const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-900";

const recommendedModelPresets = [
  {
    code: "gpt-5.2",
    displayName: "ChatGPT 5.2",
    provider: "OPENAI" as const,
    contextWindow: 256000,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsStructuredOutputs: true,
    supportsReasoning: true,
  },
  {
    code: "gpt-5-mini",
    displayName: "ChatGPT 5 Mini",
    provider: "OPENAI" as const,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsStructuredOutputs: true,
    supportsReasoning: true,
  },
  {
    code: "gpt-4o",
    displayName: "ChatGPT 4o",
    provider: "OPENAI" as const,
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsVision: true,
    supportsStructuredOutputs: true,
    supportsReasoning: false,
  },
  {
    code: "gpt-4o-mini",
    displayName: "ChatGPT 4o Mini",
    provider: "OPENAI" as const,
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsVision: true,
    supportsStructuredOutputs: true,
    supportsReasoning: false,
  },
  {
    code: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    provider: "GOOGLE" as const,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsStructuredOutputs: true,
    supportsReasoning: true,
  },
  {
    code: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    provider: "GOOGLE" as const,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsStructuredOutputs: true,
    supportsReasoning: true,
  },
  {
    code: "gemini-2.0-flash",
    displayName: "Gemini 2.0 Flash",
    provider: "GOOGLE" as const,
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsVision: true,
    supportsStructuredOutputs: true,
    supportsReasoning: false,
  },
  {
    code: "gemini-3-pro-preview",
    displayName: "Gemini 3 Pro Preview",
    provider: "GOOGLE" as const,
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsStructuredOutputs: true,
    supportsReasoning: true,
  },
  {
    code: "gemini-3-pro-preview-thinking",
    displayName: "Gemini 3 Pro Preview Thinking",
    provider: "GOOGLE" as const,
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsStructuredOutputs: true,
    supportsReasoning: true,
  },
];

function toNullableNumber(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function LlmConfigManager() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [models, setModels] = useState<PlatformLlmModel[]>([]);
  const [profiles, setProfiles] = useState<PlatformLlmProfile[]>([]);
  const [health, setHealth] = useState<ProviderHealth[]>([]);

  async function load() {
    setLoading(true);
    try {
      const [modelsResponse, profilesResponse, healthResponse] = await Promise.all([
        fetch("/api/superadmin/llm-models", { cache: "no-store" }),
        fetch("/api/superadmin/llm-profiles", { cache: "no-store" }),
        fetch("/api/superadmin/llm-health", { cache: "no-store" }),
      ]);
      const [modelsData, profilesData, healthData] = await Promise.all([
        modelsResponse.json(),
        profilesResponse.json(),
        healthResponse.json(),
      ]);
      if (!modelsResponse.ok || modelsData.status === "error") {
        throw new Error(modelsData.message ?? "Failed to load LLM models.");
      }
      if (!profilesResponse.ok || profilesData.status === "error") {
        throw new Error(profilesData.message ?? "Failed to load LLM profiles.");
      }
      if (!healthResponse.ok || healthData.status === "error") {
        throw new Error(healthData.message ?? "Failed to load provider health.");
      }
      setModels(modelsData.models ?? []);
      setProfiles(profilesData.profiles ?? []);
      setHealth(healthData.providers ?? []);
      setMessage(null);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to load LLM configuration.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submitJson(url: string, method: "POST" | "PATCH", body: unknown) {
    setSubmitting(true);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok || data.status === "error") {
        throw new Error(data.message ?? "Request failed.");
      }
      setMessage({ type: "success", text: "Saved." });
      await load();
      return data;
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Request failed.",
      });
      throw error;
    } finally {
      setSubmitting(false);
    }
  }

  async function addRecommendedModelPresets() {
    const existingCodes = new Set(models.map((model) => model.code.trim().toLowerCase()));
    const missingPresets = recommendedModelPresets.filter((preset) => !existingCodes.has(preset.code.toLowerCase()));
    if (missingPresets.length === 0) {
      setMessage({ type: "success", text: "Recommended ChatGPT and Gemini presets already exist in the model catalog." });
      return;
    }

    setSubmitting(true);
    try {
      for (const preset of missingPresets) {
        const response = await fetch("/api/superadmin/llm-models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(preset),
        });
        const data = await response.json();
        if (!response.ok || data.status === "error") {
          throw new Error(data.message ?? `Failed to add preset ${preset.code}.`);
        }
      }
      setMessage({
        type: "success",
        text: `Added ${missingPresets.length} recommended model preset${missingPresets.length > 1 ? "s" : ""}.`,
      });
      await load();
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to add recommended model presets.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="rounded-3xl border border-slate-200 bg-white/70 p-6 text-sm text-slate-500">Loading LLM configuration...</div>;
  }

  return (
    <div className="space-y-6">
      {message ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            message.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white/80 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Provider Health</h2>
            <p className="text-sm text-slate-500">Environment-backed provider status used by accreditation copilot.</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-full border border-slate-900 px-4 py-2 text-sm font-semibold text-slate-900"
          >
            Refresh
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {health.map((provider) => (
            <div key={provider.providerCode} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-sm font-semibold uppercase text-slate-900">{provider.providerCode}</div>
              <div className="mt-2 text-xs text-slate-500">
                {provider.configured ? "Configured" : "No API key"}
              </div>
              <div className={`mt-2 text-xs font-semibold ${provider.healthy ? "text-emerald-700" : "text-amber-700"}`}>
                {provider.healthy ? "Healthy" : "Unavailable"}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_1fr]">
        <section className="space-y-4 rounded-3xl border border-slate-200 bg-white/80 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-900">Models</h2>
            <button
              type="button"
              onClick={() => void addRecommendedModelPresets()}
              disabled={submitting}
              className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
            >
              Add ChatGPT + Gemini presets
            </button>
          </div>
          <p className="text-sm text-slate-500">Platform-managed model catalog available to accreditation body versions.</p>
          <p className="text-xs text-slate-500">
            Guardrail: Google models should use <code>gemini-*</code>; OpenAI models should use <code>gpt-*</code>, <code>o1-*</code>, or <code>o3-*</code>.
          </p>

          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const code = String(form.get("code") ?? "").trim();
              const displayName = String(form.get("displayName") ?? "").trim();
              const provider = String(form.get("provider") ?? "OPENAI");
              const contextWindow = Number(form.get("contextWindow") ?? 128000);
              if (!code || !displayName) {
                setMessage({ type: "error", text: "Model code and display name are required." });
                return;
              }
              if (!Number.isInteger(contextWindow) || contextWindow < 1) {
                setMessage({ type: "error", text: "Context window must be a positive whole number." });
                return;
              }
              if (provider === "GOOGLE" && !code.toLowerCase().startsWith("gemini")) {
                setMessage({ type: "error", text: 'Google provider models must use a code starting with "gemini".' });
                return;
              }
              await submitJson("/api/superadmin/llm-models", "POST", {
                code,
                displayName,
                provider,
                contextWindow,
                maxOutputTokens: toNullableNumber(form.get("maxOutputTokens")),
                supportsVision: form.get("supportsVision") === "on",
                supportsStructuredOutputs: form.get("supportsStructuredOutputs") === "on",
                supportsReasoning: form.get("supportsReasoning") === "on",
              });
              event.currentTarget.reset();
            }}
          >
            <input name="code" placeholder="Model code" className={inputClassName} />
            <input name="displayName" placeholder="Display name" className={inputClassName} />
            <select name="provider" className={inputClassName} defaultValue="OPENAI">
              <option value="OPENAI">OPENAI</option>
              <option value="ANTHROPIC">ANTHROPIC</option>
              <option value="GOOGLE">GOOGLE</option>
              <option value="DEEPSEEK">DEEPSEEK</option>
              <option value="GROQ">GROQ</option>
            </select>
            <input name="contextWindow" type="number" className={inputClassName} defaultValue={128000} />
            <input name="maxOutputTokens" type="number" placeholder="Max output tokens" className={inputClassName} />
            <div className="grid grid-cols-3 gap-3 md:col-span-2">
              <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" name="supportsVision" className="h-4 w-4 rounded" />Vision</label>
              <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" name="supportsStructuredOutputs" className="h-4 w-4 rounded" />Structured output</label>
              <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" name="supportsReasoning" className="h-4 w-4 rounded" />Reasoning</label>
            </div>
            <button type="submit" disabled={submitting} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-2">
              Add model
            </button>
          </form>

          <div className="space-y-2">
            {models.map((model) => (
              <div key={model.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{model.displayName}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {model.code} · {model.provider} · {model.contextWindow.toLocaleString()} ctx
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void submitJson("/api/superadmin/llm-models", "PATCH", { id: model.id, isDefault: !model.isDefault })}
                      className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700"
                    >
                      {model.isDefault ? "Unset default" : "Set default"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitJson("/api/superadmin/llm-models", "PATCH", { id: model.id, isActive: !model.isActive })}
                      className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700"
                    >
                      {model.isActive ? "Archive" : "Restore"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4 rounded-3xl border border-slate-200 bg-white/80 p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Profiles</h2>
            <p className="text-sm text-slate-500">Reusable model profiles selected by accreditation body versions.</p>
          </div>

          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              await submitJson("/api/superadmin/llm-profiles", "POST", {
                key: String(form.get("key") ?? ""),
                displayName: String(form.get("displayName") ?? ""),
                description: String(form.get("description") ?? "") || null,
                primaryModelId: String(form.get("primaryModelId") ?? ""),
                defaultMaxTokensOut: toNullableNumber(form.get("defaultMaxTokensOut")),
                defaultTemperature: toNullableNumber(form.get("defaultTemperature")),
                defaultReasoningEffort: String(form.get("defaultReasoningEffort") ?? "") || null,
                supportsStructuredOutputs: form.get("supportsStructuredOutputs") === "on",
                usageTags: String(form.get("usageTags") ?? "")
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
              });
              event.currentTarget.reset();
            }}
          >
            <input name="key" placeholder="Profile key" className={inputClassName} />
            <input name="displayName" placeholder="Display name" className={inputClassName} />
            <select name="primaryModelId" className={`${inputClassName} md:col-span-2`} defaultValue="">
              <option value="">Select primary model</option>
              {models.filter((model) => model.isActive).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName} · {model.code}
                </option>
              ))}
            </select>
            <textarea name="description" placeholder="Description" className={`${inputClassName} min-h-24 md:col-span-2`} />
            <input name="defaultMaxTokensOut" type="number" placeholder="Default max output tokens" className={inputClassName} />
            <input name="defaultTemperature" type="number" step="0.1" placeholder="Default temperature" className={inputClassName} />
            <input name="defaultReasoningEffort" placeholder="Reasoning effort (optional)" className={inputClassName} />
            <input name="usageTags" placeholder="Usage tags, comma separated" className={inputClassName} />
            <label className="flex items-center gap-2 text-sm text-slate-600 md:col-span-2">
              <input type="checkbox" name="supportsStructuredOutputs" className="h-4 w-4 rounded" />
              Structured JSON output expected
            </label>
            <button type="submit" disabled={submitting} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-2">
              Add profile
            </button>
          </form>

          <div className="space-y-2">
            {profiles.map((profile) => (
              <div key={profile.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{profile.displayName}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {profile.key} · primary {profile.primaryModel.displayName}
                    </div>
                    {profile.usageTags.length > 0 ? (
                      <div className="mt-2 text-xs text-slate-500">{profile.usageTags.join(", ")}</div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void submitJson("/api/superadmin/llm-profiles", "PATCH", { id: profile.id, isDefault: !profile.isDefault })}
                      className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700"
                    >
                      {profile.isDefault ? "Unset default" : "Set default"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitJson("/api/superadmin/llm-profiles", "PATCH", { id: profile.id, isActive: !profile.isActive })}
                      className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700"
                    >
                      {profile.isActive ? "Archive" : "Restore"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
