"use client";

import type { AchievementFieldConfig } from "@/lib/kra-kpi/shared";

type Props = {
  fields: AchievementFieldConfig[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  errors?: Record<string, string>;
  readOnly?: boolean;
};

export function DynamicFormRenderer({ fields, values, onChange, errors, readOnly }: Props) {
  const sorted = [...fields].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return (
    <div className="space-y-4">
      {sorted.map((field) => (
        <div key={field.key}>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {field.label}
            {field.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>

          {field.helpText && (
            <p className="text-xs text-gray-500 mb-1">{field.helpText}</p>
          )}

          {renderField(field, values[field.key], (v) => onChange(field.key, v), readOnly)}

          {errors?.[field.key] && (
            <p className="mt-1 text-xs text-red-600">{errors[field.key]}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function renderField(
  field: AchievementFieldConfig,
  value: unknown,
  onChange: (v: unknown) => void,
  readOnly?: boolean,
) {
  const baseClass = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100";

  switch (field.type) {
    case "TEXT":
      return (
        <input
          type="text"
          className={baseClass}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          pattern={field.pattern}
          disabled={readOnly}
        />
      );

    case "TEXTAREA":
      return (
        <textarea
          className={baseClass}
          rows={3}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          disabled={readOnly}
        />
      );

    case "NUMBER":
      return (
        <input
          type="number"
          className={baseClass}
          value={value != null ? String(value) : ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          placeholder={field.placeholder}
          disabled={readOnly}
        />
      );

    case "DATE":
      return (
        <input
          type="date"
          className={baseClass}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
        />
      );

    case "URL":
      return (
        <input
          type="url"
          className={baseClass}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? "https://..."}
          disabled={readOnly}
        />
      );

    case "EMAIL":
      return (
        <input
          type="email"
          className={baseClass}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          disabled={readOnly}
        />
      );

    case "SELECT":
      return (
        <select
          className={baseClass}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
        >
          <option value="">Select...</option>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );

    case "MULTI_SELECT": {
      const selected = (value as string[]) ?? [];
      return (
        <div className="space-y-1">
          {field.options?.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={(e) => {
                  if (readOnly) return;
                  const next = e.target.checked
                    ? [...selected, opt]
                    : selected.filter((s) => s !== opt);
                  onChange(next);
                }}
                disabled={readOnly}
                className="rounded border-gray-300"
              />
              {opt}
            </label>
          ))}
        </div>
      );
    }

    case "BOOLEAN":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            disabled={readOnly}
            className="rounded border-gray-300"
          />
          {field.label}
        </label>
      );

    case "FILE_LINK":
      return (
        <input
          type="url"
          className={baseClass}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="File URL or link"
          disabled={readOnly}
        />
      );

    default:
      return (
        <input
          type="text"
          className={baseClass}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
        />
      );
  }
}
