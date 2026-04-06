"use client";

import { useState } from "react";
import { Plus, ChevronDown, Blocks } from "lucide-react";
import { SlideOver, EmptyState } from "@/components/dashboard/shared";
import { label, BLOCK_TYPE_LABELS, LIFECYCLE_LABELS, inputClassName, labelClassName, textAreaClassName } from "./constants";
import type { AccreditationManagerHook } from "./use-accreditation-manager";

type Props = Pick<
  AccreditationManagerHook,
  | "submitting"
  | "selectedVersion" | "flatBlocks" | "selectedBlockId" | "setSelectedBlockId" | "selectedBlock"
  | "flatCriteria"
  | "canEditSelectedVersionBlocks" | "canEditAssistantRules"
  | "createBlock" | "updateBlock" | "toggleBlockActive"
  | "validateDraft" | "publishVersion"
>;

function toNullableNumber(val: FormDataEntryValue | null): number | null {
  if (typeof val !== "string" || !val.trim()) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

export function TemplateBlocksTab(props: Props) {
  const {
    submitting,
    selectedVersion, flatBlocks, selectedBlockId, setSelectedBlockId, selectedBlock,
    flatCriteria,
    canEditSelectedVersionBlocks, canEditAssistantRules,
    createBlock, updateBlock, toggleBlockActive,
    validateDraft, publishVersion,
  } = props;

  const [showCreateBlock, setShowCreateBlock] = useState(false);

  if (!selectedVersion) {
    return (
      <div className="rounded-[1.75rem] border border-dashed border-slate-200 bg-white/55 px-6 py-12 text-center">
        <p className="text-sm text-slate-500">Select a framework version from the Frameworks tab to manage template blocks.</p>
      </div>
    );
  }

  return (
    <>
      {/* Header with lifecycle actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {selectedVersion.versionCode} &middot; {label(LIFECYCLE_LABELS, selectedVersion.lifecycleStatus)}
          </h3>
          <p className="text-xs text-slate-500">Template blocks define the scoring structure. Workspace users see the published criteria tree.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEditSelectedVersionBlocks ? (
            <>
              <button type="button" disabled={submitting} onClick={() => void validateDraft(selectedVersion.id)}
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
                Validate Draft
              </button>
              <button type="button" disabled={submitting} onClick={() => void publishVersion(selectedVersion.id)}
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:bg-slate-300">
                Publish Template
              </button>
              <button type="button" onClick={() => setShowCreateBlock(true)}
                className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                <Plus className="h-3.5 w-3.5" />
                Add Block
              </button>
            </>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
              {selectedVersion.lifecycleStatus === "PUBLISHED"
                ? "Published templates are immutable. Fork or create a new draft."
                : "Block authoring requires an editable draft template."}
            </div>
          )}
        </div>
      </div>

      {/* Block list + detail */}
      <div className="grid gap-6 xl:grid-cols-[22rem,1fr]">
        {/* Tree list */}
        <div className="space-y-2">
          {flatBlocks.length === 0 ? (
            <EmptyState
              icon={<Blocks className="h-7 w-7" />}
              title="No blocks yet"
              description="Add template blocks to build the scoring structure for this version."
              actionLabel={canEditSelectedVersionBlocks ? "Add First Block" : undefined}
              onAction={canEditSelectedVersionBlocks ? () => setShowCreateBlock(true) : undefined}
            />
          ) : (
            flatBlocks.map((block) => (
              <button
                key={block.id}
                type="button"
                onClick={() => setSelectedBlockId(block.id)}
                className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                  selectedBlockId === block.id
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                }`}
                style={{ paddingLeft: `${block.depth * 18 + 16}px` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{block.blockCode} &middot; {block.title}</p>
                    <p className="mt-1 text-xs opacity-75">
                      {label(BLOCK_TYPE_LABELS, block.blockType)} &middot; Level {block.depth + 1}
                      {block.maxScore != null ? ` &middot; Max ${block.maxScore}` : ""}
                    </p>
                  </div>
                  {canEditSelectedVersionBlocks && selectedBlockId === block.id ? (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); void toggleBlockActive(block.id, block.isActive); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); void toggleBlockActive(block.id, block.isActive); } }}
                      className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
                        selectedBlockId === block.id ? "border-white/30 text-white" : "border-slate-300 text-slate-600"
                      }`}
                    >
                      {block.isActive ? "Archive" : "Restore"}
                    </span>
                  ) : null}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Block detail / edit */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          {!selectedBlock ? (
            <p className="py-8 text-center text-sm text-slate-500">Select a block to inspect or edit.</p>
          ) : canEditSelectedVersionBlocks ? (
            <BlockEditForm
              block={selectedBlock}
              submitting={submitting}
              canEditAssistantRules={canEditAssistantRules}
              onSave={(payload) => updateBlock(selectedBlock.id, payload)}
            />
          ) : (
            <BlockReadonlyView block={selectedBlock} />
          )}
        </div>
      </div>

      {/* Create Block SlideOver */}
      <SlideOver open={showCreateBlock} onClose={() => setShowCreateBlock(false)} title="Add Template Block" subtitle="Define a new block in the scoring tree." width="lg">
        <form className="space-y-5" onSubmit={(e) => {
          e.preventDefault();
          if (!selectedVersion) return;
          const fd = new FormData(e.currentTarget);
          void createBlock(selectedVersion.id, {
            parentId: String(fd.get("parentId") ?? "") || null,
            blockCode: String(fd.get("blockCode") ?? ""),
            title: String(fd.get("title") ?? ""),
            blockType: String(fd.get("blockType") ?? "METRIC"),
            maxScore: toNullableNumber(fd.get("maxScore")),
            sortOrder: Number(String(fd.get("sortOrder") ?? "0")) || 0,
            unitOfMeasure: String(fd.get("unitOfMeasure") ?? "") || null,
            scoringRule: String(fd.get("scoringRule") ?? "") || null,
            validationRules: String(fd.get("validationRules") ?? "") || null,
            evidenceSchema: String(fd.get("evidenceSchema") ?? "") || null,
            dependencyRules: String(fd.get("dependencyRules") ?? "") || null,
            ...(canEditAssistantRules ? { assistantConfig: String(fd.get("assistantConfig") ?? "") || null } : {}),
          }).then(() => setShowCreateBlock(false));
        }}>
          <div>
            <label className={labelClassName} htmlFor="nb-parent">Parent Block</label>
            <select id="nb-parent" name="parentId" className={inputClassName} defaultValue="">
              <option value="">Root (top level)</option>
              {flatCriteria.map((c) => <option key={c.id} value={c.id}>{"  ".repeat(c.depth)}{c.blockCode} &middot; {c.title}</option>)}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className={labelClassName} htmlFor="nb-code">Block Code</label><input id="nb-code" name="blockCode" className={inputClassName} placeholder="e.g. 1.1.1" required /></div>
            <div><label className={labelClassName} htmlFor="nb-title">Title</label><input id="nb-title" name="title" className={inputClassName} placeholder="e.g. Curriculum Design" required /></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClassName} htmlFor="nb-type">Block Type</label>
              <select id="nb-type" name="blockType" className={inputClassName} defaultValue="METRIC">
                {Object.entries(BLOCK_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div><label className={labelClassName} htmlFor="nb-score">Max Score</label><input id="nb-score" name="maxScore" type="number" step="0.01" className={inputClassName} placeholder="e.g. 20" /></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className={labelClassName} htmlFor="nb-unit">Unit of Measure</label><input id="nb-unit" name="unitOfMeasure" className={inputClassName} placeholder="e.g. %, count" /></div>
            <div><label className={labelClassName} htmlFor="nb-sort">Sort Order</label><input id="nb-sort" name="sortOrder" type="number" className={inputClassName} defaultValue={0} /></div>
          </div>
          <AdvancedJsonFields canEditAssistantRules={canEditAssistantRules} />
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={submitting} className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-300">{submitting ? "Creating..." : "Create Block"}</button>
            <button type="button" onClick={() => setShowCreateBlock(false)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          </div>
        </form>
      </SlideOver>
    </>
  );
}

// ── Block edit form (inline) ──

function BlockEditForm({
  block,
  submitting,
  canEditAssistantRules,
  onSave,
}: {
  block: NonNullable<AccreditationManagerHook["selectedBlock"]>;
  submitting: boolean;
  canEditAssistantRules: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      void onSave({
        title: String(fd.get("title") ?? ""),
        description: String(fd.get("description") ?? "") || null,
        maxScore: toNullableNumber(fd.get("maxScore")),
        unitOfMeasure: String(fd.get("unitOfMeasure") ?? "") || null,
        scoringRule: String(fd.get("scoringRule") ?? "") || null,
        validationRules: String(fd.get("validationRules") ?? "") || null,
        evidenceSchema: String(fd.get("evidenceSchema") ?? "") || null,
        dependencyRules: String(fd.get("dependencyRules") ?? "") || null,
        ...(canEditAssistantRules ? { assistantConfig: String(fd.get("assistantConfig") ?? "") || null } : {}),
      });
    }}>
      <div>
        <p className="text-xs font-medium text-slate-400">{block.blockCode} &middot; {label(BLOCK_TYPE_LABELS, block.blockType)}</p>
        <h4 className="text-lg font-semibold text-slate-900">{block.title}</h4>
      </div>
      <div><label className={labelClassName} htmlFor="be-title">Title</label><input id="be-title" name="title" defaultValue={block.title} className={inputClassName} /></div>
      <div><label className={labelClassName} htmlFor="be-desc">Description</label><textarea id="be-desc" name="description" defaultValue={block.description ?? ""} className={`${inputClassName} min-h-[5rem]`} placeholder="Block description" /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className={labelClassName} htmlFor="be-score">Max Score</label><input id="be-score" name="maxScore" type="number" step="0.01" defaultValue={block.maxScore ?? ""} className={inputClassName} /></div>
        <div><label className={labelClassName} htmlFor="be-unit">Unit of Measure</label><input id="be-unit" name="unitOfMeasure" defaultValue={block.unitOfMeasure ?? ""} className={inputClassName} /></div>
      </div>

      <button type="button" onClick={() => setShowAdvanced((p) => !p)} className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700">
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
        JSON Configuration
      </button>
      {showAdvanced ? (
        <div className="space-y-3 rounded-2xl border border-slate-100 bg-white p-4">
          <div><label className={labelClassName}>Scoring Rule</label><textarea name="scoringRule" defaultValue={block.scoringRule ? JSON.stringify(block.scoringRule, null, 2) : ""} className={textAreaClassName} /></div>
          <div><label className={labelClassName}>Validation Rules</label><textarea name="validationRules" defaultValue={block.validationRules ? JSON.stringify(block.validationRules, null, 2) : ""} className={textAreaClassName} /></div>
          <div><label className={labelClassName}>Evidence Schema</label><textarea name="evidenceSchema" defaultValue={block.evidenceSchema ? JSON.stringify(block.evidenceSchema, null, 2) : ""} className={textAreaClassName} /></div>
          <div><label className={labelClassName}>Dependency Rules</label><textarea name="dependencyRules" defaultValue={block.dependencyRules ? JSON.stringify(block.dependencyRules, null, 2) : ""} className={textAreaClassName} /></div>
          {canEditAssistantRules ? <div><label className={labelClassName}>Assistant Config</label><textarea name="assistantConfig" defaultValue={block.assistantConfig ? JSON.stringify(block.assistantConfig, null, 2) : ""} className={textAreaClassName} /></div> : null}
        </div>
      ) : null}

      <button type="submit" disabled={submitting} className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:bg-slate-300">
        {submitting ? "Saving..." : "Save Block"}
      </button>
    </form>
  );
}

// ── Readonly view ──

function BlockReadonlyView({ block }: { block: NonNullable<AccreditationManagerHook["selectedBlock"]> }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium text-slate-400">{block.blockCode} &middot; {label(BLOCK_TYPE_LABELS, block.blockType)}</p>
        <h4 className="text-lg font-semibold text-slate-900">{block.title}</h4>
        {block.description ? <p className="mt-1 text-sm text-slate-600">{block.description}</p> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-white px-3 py-2"><p className="text-xs text-slate-400">Max Score</p><p className="text-sm font-semibold text-slate-900">{block.maxScore ?? "Not set"}</p></div>
        <div className="rounded-xl bg-white px-3 py-2"><p className="text-xs text-slate-400">Unit</p><p className="text-sm font-semibold text-slate-900">{block.unitOfMeasure ?? "Not set"}</p></div>
      </div>
    </div>
  );
}

// ── Advanced JSON fields (shared between create form and edit form) ──

function AdvancedJsonFields({ canEditAssistantRules }: { canEditAssistantRules: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setShow((p) => !p)} className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700">
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${show ? "rotate-180" : ""}`} />
        Advanced JSON configuration
      </button>
      {show ? (
        <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/50 p-4">
          <div><label className={labelClassName}>Scoring Rule (JSON)</label><textarea name="scoringRule" className={textAreaClassName} placeholder='e.g. {"type":"SLAB","slabs":[...]}' /></div>
          <div><label className={labelClassName}>Validation Rules (JSON)</label><textarea name="validationRules" className={textAreaClassName} /></div>
          <div><label className={labelClassName}>Evidence Schema (JSON)</label><textarea name="evidenceSchema" className={textAreaClassName} /></div>
          <div><label className={labelClassName}>Dependency Rules (JSON)</label><textarea name="dependencyRules" className={textAreaClassName} placeholder='e.g. [{"targetBlockCode":"1.1"}]' /></div>
          {canEditAssistantRules ? <div><label className={labelClassName}>Assistant Config (JSON)</label><textarea name="assistantConfig" className={textAreaClassName} /></div> : null}
        </div>
      ) : null}
    </>
  );
}
