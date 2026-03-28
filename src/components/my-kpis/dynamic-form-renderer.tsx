"use client";

import {
  getRenderableAchievementFields,
  isAchievementFieldRequired,
  type AchievementFieldConfig,
} from "@/lib/kra-kpi/shared";

type Props = {
  fields: AchievementFieldConfig[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  errors?: Record<string, string>;
  readOnly?: boolean;
};

export function DynamicFormRenderer({ fields, values, onChange, errors, readOnly }: Props) {
  const renderable = getRenderableAchievementFields(fields, values, {
    readOnly,
    showHiddenWithValue: true,
  });

  return (
    <div className="space-y-4">
      {renderable.map((field) => {
        const isDeclaration = field.type === "DECLARATION";
        return (
          <div key={field.key}>
            {!isDeclaration ? (
              <>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  {field.label}
                  {isAchievementFieldRequired(field, values) && (
                    <span className="ml-0.5 text-red-500">*</span>
                  )}
                </label>

                {field.helpText && (
                  <p className="mb-1 text-xs text-gray-500">{field.helpText}</p>
                )}
              </>
            ) : null}

            {renderField(field, values[field.key], (v) => onChange(field.key, v), readOnly, values)}

            {errors?.[field.key] && (
              <p className="mt-1 text-xs text-red-600">{errors[field.key]}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function renderField(
  field: AchievementFieldConfig,
  value: unknown,
  onChange: (v: unknown) => void,
  readOnly?: boolean,
  values?: Record<string, unknown>,
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
          minLength={field.validation?.minLength}
          maxLength={field.validation?.maxLength}
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
          minLength={field.validation?.minLength}
          maxLength={field.validation?.maxLength}
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
          min={field.validation?.min}
          max={field.validation?.max}
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

    case "DECLARATION":
      return (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <label className="flex items-start gap-2 text-sm text-amber-950">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => onChange(e.target.checked)}
              disabled={readOnly}
              className="mt-0.5 rounded border-amber-300"
            />
            <span>
              <span className="font-medium">{field.label}</span>
              {isAchievementFieldRequired(field, values ?? {}) && (
                <span className="ml-0.5 text-red-500">*</span>
              )}
            </span>
          </label>
          {field.helpText ? (
            <p className="mt-2 ml-6 text-xs text-amber-900/80">{field.helpText}</p>
          ) : null}
        </div>
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
