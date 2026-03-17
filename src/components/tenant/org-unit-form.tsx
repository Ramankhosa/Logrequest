"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

export type OrgUnitFormProps = {
  types: Array<{ id: string; displayLabel: string }>;
  units: Array<{ id: string; code: string }>;
};

const unitSchema = z.object({
  typeId: z.string().trim().min(1, "Select a type."),
  code: z
    .string()
    .trim()
    .min(2, "Code is required.")
    .regex(/^[A-Z0-9_-]+$/, "Uppercase letters, numbers, hyphen, or underscore."),
  name: z.string().trim().min(2, "Name is required."),
  parentId: z.string().optional(),
});

type UnitFormValues = z.infer<typeof unitSchema>;

const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-900";

export function OrgUnitForm({ types, units }: OrgUnitFormProps) {
  const [result, setResult] = useState("");
  const [isPending, startTransition] = useTransition();
  const form = useForm<UnitFormValues>({
    resolver: zodResolver(unitSchema),
    defaultValues: {
      typeId: types[0]?.id ?? "",
      code: "",
      name: "",
      parentId: "",
    },
  });

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      setResult("");

      try {
        const response = await fetch("/api/tenant/structure/units", {
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

        form.reset({
          typeId: values.typeId,
          code: "",
          name: "",
          parentId: "",
        });
        setResult("Unit created.");
      } catch (error) {
        setResult(error instanceof Error ? error.message : "Request failed.");
      }
    });
  });

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="Unit type"
          error={form.formState.errors.typeId?.message}
          input={
            <select {...form.register("typeId")} className={inputClassName}>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.displayLabel}
                </option>
              ))}
            </select>
          }
        />
        <Field
          label="Code"
          error={form.formState.errors.code?.message}
          input={<input {...form.register("code")} className={inputClassName} />}
        />
        <Field
          label="Name"
          error={form.formState.errors.name?.message}
          input={<input {...form.register("name")} className={inputClassName} />}
        />
        <Field
          label="Parent unit"
          error={form.formState.errors.parentId?.message}
          input={
            <select {...form.register("parentId")} className={inputClassName}>
              <option value="">No parent</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.code}
                </option>
              ))}
            </select>
          }
        />
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
        {isPending ? "Saving..." : "Create unit"}
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
