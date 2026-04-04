import { Prisma } from "@prisma/client";
import { parseFormulaDependencyBlockCodes } from "./block-formula-evaluator";

export type BlockDependencyPlannerBlock = {
  blockCode: string;
  dependencyRules: Prisma.JsonValue | null;
  calculationRule: Prisma.JsonValue | null;
  scoringRule: Prisma.JsonValue | null;
};

export type BlockDependencyPlan = {
  orderedBlockCodes: string[];
  dependencyMap: Record<string, string[]>;
};

function asJsonObject(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Prisma.JsonObject;
}

function asJsonArray(value: Prisma.JsonValue | null | undefined) {
  return Array.isArray(value) ? value : [];
}

function extractDependencyTargetsFromRules(blockCode: string, dependencyRules: Prisma.JsonValue | null) {
  const targets = new Set<string>();
  for (const rule of asJsonArray(dependencyRules)) {
    const ruleObject = asJsonObject(rule as Prisma.JsonValue);
    const targetBlockCode = typeof ruleObject?.targetBlockCode === "string" ? ruleObject.targetBlockCode.trim() : "";
    if (targetBlockCode && targetBlockCode !== blockCode) {
      targets.add(targetBlockCode);
    }
  }
  return targets;
}

function collectFormulaStrings(value: Prisma.JsonValue | null | undefined, formulas: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFormulaStrings(item, formulas);
    }
    return;
  }
  const objectValue = asJsonObject(value);
  if (!objectValue) {
    return;
  }
  for (const [key, item] of Object.entries(objectValue)) {
    if (key.toLowerCase().includes("formula") || key === "when" || key === "condition") {
      if (typeof item === "string" && item.trim().length > 0) {
        formulas.add(item);
      }
      continue;
    }
    if (typeof item !== "string") {
      collectFormulaStrings(item, formulas);
    }
  }
}

function extractDependencyTargetsFromFormulas(block: BlockDependencyPlannerBlock) {
  const formulas = new Set<string>();
  collectFormulaStrings(block.calculationRule, formulas);
  collectFormulaStrings(block.scoringRule, formulas);
  return new Set(
    [...formulas]
      .flatMap((formula) => parseFormulaDependencyBlockCodes(formula))
      .filter((target) => target !== block.blockCode),
  );
}

function buildDependencyGraph(blocks: BlockDependencyPlannerBlock[]) {
  const blockCodes = new Set(blocks.map((block) => block.blockCode));
  const dependencyMap = new Map<string, Set<string>>();

  for (const block of blocks) {
    const dependencies = dependencyMap.get(block.blockCode) ?? new Set<string>();
    for (const target of extractDependencyTargetsFromRules(block.blockCode, block.dependencyRules)) {
      if (!blockCodes.has(target)) {
        throw new Error(`Block ${block.blockCode} depends on unknown block ${target}.`);
      }
      dependencies.add(target);
    }
    for (const target of extractDependencyTargetsFromFormulas(block)) {
      if (!blockCodes.has(target)) {
        throw new Error(`Block ${block.blockCode} references unknown dependency block ${target}.`);
      }
      dependencies.add(target);
    }
    dependencyMap.set(block.blockCode, dependencies);
  }

  return dependencyMap;
}

function findDependencyCycle(graph: Map<string, Set<string>>) {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (blockCode: string, path: string[]): string[] | null => {
    if (visiting.has(blockCode)) {
      const cycleStart = path.indexOf(blockCode);
      return cycleStart >= 0 ? [...path.slice(cycleStart), blockCode] : [blockCode, blockCode];
    }
    if (visited.has(blockCode)) {
      return null;
    }

    visiting.add(blockCode);
    for (const dependency of graph.get(blockCode) ?? []) {
      const cycle = visit(dependency, [...path, blockCode]);
      if (cycle) {
        return cycle;
      }
    }
    visiting.delete(blockCode);
    visited.add(blockCode);
    return null;
  };

  for (const blockCode of graph.keys()) {
    const cycle = visit(blockCode, []);
    if (cycle) {
      return cycle;
    }
  }

  return null;
}

export function planBlockDependencies(blocks: BlockDependencyPlannerBlock[]): BlockDependencyPlan {
  const graph = buildDependencyGraph(blocks);
  const cycle = findDependencyCycle(graph);
  if (cycle) {
    throw new Error(`Block dependency cycle detected: ${cycle.join(" -> ")}.`);
  }

  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const block of blocks) {
    indegree.set(block.blockCode, 0);
    dependents.set(block.blockCode, []);
  }

  for (const [blockCode, dependencies] of graph.entries()) {
    indegree.set(blockCode, dependencies.size);
    for (const dependency of dependencies) {
      const current = dependents.get(dependency) ?? [];
      current.push(blockCode);
      dependents.set(dependency, current);
    }
  }

  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([blockCode]) => blockCode)
    .sort((left, right) => left.localeCompare(right));
  const ordered: string[] = [];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) {
      continue;
    }
    ordered.push(next);
    for (const dependent of dependents.get(next) ?? []) {
      const remaining = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) {
        queue.push(dependent);
        queue.sort((left, right) => left.localeCompare(right));
      }
    }
  }

  if (ordered.length !== blocks.length) {
    throw new Error("Failed to resolve block dependency execution order.");
  }

  return {
    orderedBlockCodes: ordered,
    dependencyMap: Object.fromEntries(
      [...graph.entries()].map(([blockCode, dependencies]) => [blockCode, [...dependencies].sort()]),
    ),
  };
}
