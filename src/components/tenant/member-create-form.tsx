"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { initialMemberCreationResult } from "@/lib/tenant-admin/shared";

const memberFormSchema = z.object({
  firstName: z.string().trim().min(2, "First name is required."),
  lastName: z.string().trim().min(2, "Last name is required."),
  officialEmail: z.string().trim().email("Enter a valid email."),
  employeeId: z.string().trim().optional(),
  role: z.enum(["TENANT_ADMIN", "TENANT_USER"]),
});

type MemberFormValues = z.infer<typeof memberFormSchema>;

export function MemberCreateForm({
  canCreateTenantAdmin,
}: {
  canCreateTenantAdmin: boolean;
}) {
  const router = useRouter();
  const [result, setResult] = useState(initialMemberCreationResult);
  const [isPending, startTransition] = useTransition();

  const form = useForm<MemberFormValues>({
    resolver: zodResolver(memberFormSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      officialEmail: "",
      employeeId: "",
      role: canCreateTenantAdmin ? "TENANT_ADMIN" : "TENANT_USER",
    },
  });

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      setResult(initialMemberCreationResult);

      let nextResult = initialMemberCreationResult;

      try {
        const response = await fetch("/api/tenant/users", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(values),
        });

        nextResult = (await response.json()) as typeof initialMemberCreationResult;
      } catch {
        nextResult = {
          status: "error",
          message: "The request could not be completed.",
        };
      }

      setResult(nextResult);

      if (nextResult.status === "success") {
        router.push("/tenant-admin/users?created=1");
        router.refresh();
      }
    });
  });

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="First name"
          error={form.formState.errors.firstName?.message}
          input={<input {...form.register("firstName")} className={inputClassName} />}
        />
        <Field
          label="Last name"
          error={form.formState.errors.lastName?.message}
          input={<input {...form.register("lastName")} className={inputClassName} />}
        />
        <Field
          label="Email"
          error={form.formState.errors.officialEmail?.message}
          input={
            <input
              {...form.register("officialEmail")}
              className={inputClassName}
              type="email"
            />
          }
        />
        <Field
          label="UID"
          error={form.formState.errors.employeeId?.message}
          input={<input {...form.register("employeeId")} className={inputClassName} />}
        />
        <Field
          label="Role"
          error={form.formState.errors.role?.message}
          input={
            <select {...form.register("role")} className={inputClassName}>
              {canCreateTenantAdmin ? (
                <option value="TENANT_ADMIN">Tenant Admin</option>
              ) : null}
              <option value="TENANT_USER">Tenant User</option>
            </select>
          }
        />
      </div>

      {result.status === "error" ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {result.message}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          type="submit"
          disabled={isPending}
        >
          {isPending ? "Saving..." : "Create user"}
        </button>
      </div>
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
    <label className="space-y-2">
      <span className="text-sm font-semibold text-slate-800">{label}</span>
      {input}
      <span className="block min-h-5 text-xs text-rose-600">{error ?? ""}</span>
    </label>
  );
}

const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900";
