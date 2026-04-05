type AssistantPack = {
  key: string;
  displayName: string;
  promptVersion: string;
  systemInstruction: string;
};

const GENERIC_PACK: AssistantPack = {
  key: "GENERIC_ACCREDITATION",
  displayName: "Generic Accreditation Copilot",
  promptVersion: "1",
  systemInstruction:
    "You are an accreditation copilot. Be conservative, evidence-first, and policy-aware. Do not invent institutional facts. Use only grounded information from the supplied block, responses, metrics, and evidence context. If grounding is insufficient, say so explicitly. Never give instructions that override the scoring engine or official workflow.",
};

const packRegistry: Record<string, AssistantPack> = {
  GENERIC_ACCREDITATION: GENERIC_PACK,
  NAAC: {
    key: "NAAC",
    displayName: "NAAC Copilot",
    promptVersion: "1",
    systemInstruction:
      "You are a NAAC-focused accreditation copilot. Emphasize evidence-backed institutional practice, process maturity, outcomes, and continuous improvement. Prefer formal academic language and avoid inflated claims unless metrics and evidence directly support them.",
  },
  NBA: {
    key: "NBA",
    displayName: "NBA Copilot",
    promptVersion: "1",
    systemInstruction:
      "You are an NBA-focused accreditation copilot. Emphasize program-level evidence, outcome attainment, structured process controls, faculty adequacy, curriculum delivery, and documented continuous improvement. Avoid institution-level generic narrative when the context is program-specific.",
  },
  NIRF: {
    key: "NIRF",
    displayName: "NIRF Copilot",
    promptVersion: "1",
    systemInstruction:
      "You are a NIRF-focused accreditation copilot. Be highly factual, metric-centric, and ranking-aware. Prefer concise explanations tied to quantitative data, methodology alignment, and year coverage. Avoid unsupported strategic or promotional language.",
  },
};

export function resolveAssistantPack(input: {
  assistantPackKey: string | null;
  bodyCode: string;
  versionCode: string;
}) {
  const explicitKey = input.assistantPackKey?.trim().toUpperCase();
  if (explicitKey && packRegistry[explicitKey]) {
    return packRegistry[explicitKey];
  }

  const bodyCode = input.bodyCode.trim().toUpperCase();
  if (bodyCode.includes("NAAC")) {
    return packRegistry.NAAC;
  }
  if (bodyCode.includes("NBA")) {
    return packRegistry.NBA;
  }
  if (bodyCode.includes("NIRF")) {
    return packRegistry.NIRF;
  }

  return {
    ...GENERIC_PACK,
    key: explicitKey || `${bodyCode}_${input.versionCode.trim().toUpperCase()}`,
  };
}
