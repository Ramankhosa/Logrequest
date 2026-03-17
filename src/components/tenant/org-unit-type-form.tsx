"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const internalCategories = [
  "ORG_ROOT",
  "CAMPUS",
  "SCHOOL_LIKE_UNIT",
  "DEPARTMENT_LIKE_UNIT",
  "CENTER",
  "LAB",
  "OFFICE",
  "DIVISION",
  "PROGRAM",
  "ADMINISTRATIVE_UNIT",
  "BUSINESS_UNIT",
  "FUNCTION",
  "TEAM",
  "REGION",
  "BRANCH",
  "SITE",
  "PROJECT_UNIT",
  "CUSTOM_UNIT",
] as const;

const unitTypeSchema = z.object({
  typeKey: z
    .string()
    .trim()
    .min(2, "Enter at least 2 characters.")
    .regex(/^[A-Z0-9_]+$/, "Use uppercase letters, numbers, or underscores."),
  displayLabel: z.string().trim().min(2, "Provide a label."),
  internalCategory: z.enum(internalCategories),
  allowRoot: z.boolean(),
});

type UnitTypeFormValues = z.infer<typeof unitTypeSchema>;

const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-900";

export function OrgUnitTypeForm() {
  const [result, setResult] = useState("");
  const [isPending, startTransition] = useTransition();
  const form = useForm<UnitTypeFormValues>({
    resolver: zodResolver(unitTypeSchema),
    defaultValues: {
      typeKey: "",
      displayLabel: "",
      internalCategory: "BUSINESS_UNIT",
      allowRoot: false,
    },
  });

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      setResult("");

      try {
        const response = await fetch("/api/tenant/structure/unit-types", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(values),
        });

        const json = await response.json();

        if (!response.ok) {
          throw new Error(json.message ?? "Request failed.");
        }

        form.reset({ ...values, typeKey: "", displayLabel: "" });
        setResult("Unit type created.");
      } catch (error) {
        setResult(error instanceof Error ? error.message : "Something went wrong.");
      }
    });
  });

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="Type key"
          error={form.formState.errors.typeKey?.message}
          input={<input {...form.register("typeKey")} className={inputClassName} />}
        />
        <Field
          label="Label"
          error={form.formState.errors.displayLabel?.message}
          input={
            <input {...form.register("displayLabel")} className={inputClassName} />
          }
        />
        <Field
          label="Internal category"
          error={form.formState.errors.internalCategory?.message}
          input={
            <select {...form.register("internalCategory")} className={inputClassName}>
              {internalCategories.map((option) => (
                <option key={option} value={option}>
                  {option.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          }
        />
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-slate-200 text-slate-900 focus:ring-slate-900"
            {...form.register("allowRoot")}
          />
          <span className="text-sm text-slate-600">Allow this type to be root</span>
        </label>
      </div>

      {result ? (
        <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-700">
          {result}
        </div>
      ) : null}

      <button
        type="submit"
        className="inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
        disabled={isPending}
      >
        {isPending ? "Saving..." : "Create unit type"}
      </button>
    </form>
  );
}

function Field({
  label,
  input,
  error,
}: {
  label: string;
  input: React.ReactNode;
  error?: string;
}) {
  return (
    <label className="space-y-2 text-sm font-medium text-slate-700">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</div>
      {input}
      <span className="block min-h-4 text-xs text-rose-600">{error ?? ""}</span>
    </label>
  );
}
