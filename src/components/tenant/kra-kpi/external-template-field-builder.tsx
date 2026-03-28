"use client";

import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import {
  ACHIEVEMENT_FIELD_TYPES,
  type AchievementFieldConfig,
} from "@/lib/kra-kpi/shared";
import { BASE_EXTERNAL_CONTRIBUTOR_FIELDS } from "@/lib/kra-kpi/external-contrib-shared";

const baseFieldKeys = new Set(BASE_EXTERNAL_CONTRIBUTOR_FIELDS.map((field) => field.key));
const EXTERNAL_TEMPLATE_FIELD_TYPES = ACHIEVEMENT_FIELD_TYPES.filter(
  (type) => type !== "DECLARATION",
);

const emptyField = (index: number): AchievementFieldConfig => ({
  key: `field${index + 1}`,
  label: "New Field",
  type: "TEXT",
  required: false,
  sortOrder: index,
});

function normalizeFields(fields: AchievementFieldConfig[]): AchievementFieldConfig[] {
  return fields.map((field, index) => ({
    ...field,
    sortOrder: index,
    options: field.options && field.options.length > 0 ? field.options : undefined,
    pattern: field.pattern?.trim() || undefined,
    placeholder: field.placeholder?.trim() || undefined,
    helpText: field.helpText?.trim() || undefined,
  }));
}

function parseOptions(value: string): string[] | undefined {
  const options = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return options.length > 0 ? options : undefined;
}

export function ExternalTemplateFieldBuilder({
  value,
  onChange,
}: {
  value: AchievementFieldConfig[];
  onChange: (fields: AchievementFieldConfig[]) => void;
}) {
  const fields = normalizeFields(value);

  const updateField = (index: number, patch: Partial<AchievementFieldConfig>) => {
    const next = fields.map((field, fieldIndex) =>
      fieldIndex === index ? { ...field, ...patch } : field,
    );
    onChange(normalizeFields(next));
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= fields.length) {
      return;
    }

    const next = [...fields];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    onChange(normalizeFields(next));
  };

  const addField = () => {
    onChange(normalizeFields([...fields, emptyField(fields.length)]));
  };

  const removeField = (index: number) => {
    if (baseFieldKeys.has(fields[index]?.key ?? "")) {
      return;
    }
    onChange(normalizeFields(fields.filter((_, fieldIndex) => fieldIndex !== index)));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Template Fields
          </p>
          <p className="mt-1 text-xs text-slate-500">
            `name` and `affiliation` are required base fields and cannot be removed.
          </p>
        </div>
        <button
          type="button"
          onClick={addField}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300"
        >
          <Plus className="h-3.5 w-3.5" />
          Add field
        </button>
      </div>

      <div className="space-y-3">
        {fields.map((field, index) => {
          const isBaseField = baseFieldKeys.has(field.key);
          const needsOptions = field.type === "SELECT" || field.type === "MULTI_SELECT";

          return (
            <div
              key={`${field.key}-${index}`}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <GripVertical className="h-4 w-4 text-slate-300" />
                  <span className="text-sm font-semibold text-slate-900">
                    {field.label || `Field ${index + 1}`}
                  </span>
                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-500">
                    {field.type}
                  </span>
                  {isBaseField && (
                    <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                      Required base field
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveField(index, -1)}
                    disabled={index === 0}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-slate-300 disabled:opacity-40"
                    title="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveField(index, 1)}
                    disabled={index === fields.length - 1}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-slate-300 disabled:opacity-40"
                    title="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  {!isBaseField && (
                    <button
                      type="button"
                      onClick={() => removeField(index)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-rose-200 hover:text-rose-600"
                      title="Remove field"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Label
                  </label>
                  <input
                    type="text"
                    value={field.label}
                    onChange={(event) => updateField(index, { label: event.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Key
                  </label>
                  <input
                    type="text"
                    value={field.key}
                    disabled={isBaseField}
                    onChange={(event) =>
                      updateField(index, { key: event.target.value.replace(/\s+/g, "_") })
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand/30 disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Type
                  </label>
                  <select
                    value={field.type}
                    disabled={isBaseField}
                    onChange={(event) =>
                      updateField(index, {
                        type: event.target.value as AchievementFieldConfig["type"],
                        options:
                          event.target.value === "SELECT" ||
                          event.target.value === "MULTI_SELECT"
                            ? field.options ?? ["Option 1"]
                            : undefined,
                      })
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand/30 disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    {EXTERNAL_TEMPLATE_FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-5 pt-6">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={field.required}
                      disabled={isBaseField}
                      onChange={(event) => updateField(index, { required: event.target.checked })}
                      className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand/30 disabled:opacity-50"
                    />
                    Required
                  </label>
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Placeholder
                  </label>
                  <input
                    type="text"
                    value={field.placeholder ?? ""}
                    onChange={(event) => updateField(index, { placeholder: event.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Help text
                  </label>
                  <input
                    type="text"
                    value={field.helpText ?? ""}
                    onChange={(event) => updateField(index, { helpText: event.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
                  />
                </div>

                {(field.type === "TEXT" || field.type === "EMAIL") && (
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Pattern
                    </label>
                    <input
                      type="text"
                      value={field.pattern ?? ""}
                      onChange={(event) => updateField(index, { pattern: event.target.value })}
                      placeholder={field.type === "EMAIL" ? "" : "Optional regex"}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
                    />
                  </div>
                )}

                {needsOptions && (
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Options
                    </label>
                    <textarea
                      rows={2}
                      value={(field.options ?? []).join(", ")}
                      onChange={(event) =>
                        updateField(index, { options: parseOptions(event.target.value) })
                      }
                      placeholder="Comma-separated values"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
