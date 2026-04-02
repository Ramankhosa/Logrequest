"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { OnboardingOptions } from "@/lib/personnel/shared";

type Props = {
  canCreateAdmin: boolean;
  units: OnboardingOptions["units"];
  roles: OnboardingOptions["roles"];
  permissionRoles: OnboardingOptions["permissionRoles"];
  canAssignPermissionRoles: boolean;
};

type FormValues = {
  firstName: string;
  lastName: string;
  officialEmail: string;
  employeeId: string;
  designation: string;
  dateOfJoining: string;
  role: "TENANT_ADMIN" | "TENANT_USER";
  primaryUnitCode: string;
  secondaryUnitCodes: string[];
  roleKeys: string[];
  permissionRoleCodes: OnboardingOptions["permissionRoles"][number]["code"][];
};

const INITIAL_VALUES: FormValues = {
  firstName: "",
  lastName: "",
  officialEmail: "",
  employeeId: "",
  designation: "",
  dateOfJoining: "",
  role: "TENANT_USER",
  primaryUnitCode: "",
  secondaryUnitCodes: [],
  roleKeys: [],
  permissionRoleCodes: [],
};

const STEPS = ["User Details", "Unit & Role Assignment", "Review & Confirm"] as const;

const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900";

export function PersonnelOnboardForm({
  canCreateAdmin,
  units,
  roles,
  permissionRoles,
  canAssignPermissionRoles,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<FormValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [apiError, setApiError] = useState("");
  const [isPending, setIsPending] = useState(false);

  // ── Unit search ───────────────────────────────────────────────────────────
  const [unitQuery, setUnitQuery] = useState("");
  const unitOptions = useMemo(() => buildUnitOptions(units), [units]);
  const normalizedQuery = unitQuery.trim().toLowerCase();
  const filteredUnits = normalizedQuery
    ? unitOptions.filter((o) => o.search.includes(normalizedQuery))
    : unitOptions;

  const secondaryOptions = useMemo(
    () => unitOptions.filter((o) => o.code !== values.primaryUnitCode),
    [unitOptions, values.primaryUnitCode],
  );

  // ── Field updater ─────────────────────────────────────────────────────────
  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setApiError("");
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function validateStep1(): boolean {
    const e: typeof errors = {};
    if (values.firstName.trim().length < 2) e.firstName = "At least 2 characters.";
    if (values.lastName.trim().length < 2) e.lastName = "At least 2 characters.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.officialEmail.trim()))
      e.officialEmail = "Enter a valid email.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function validateStep2(): boolean {
    const e: typeof errors = {};
    if (!values.primaryUnitCode) e.primaryUnitCode = "Select a primary unit.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleNext() {
    if (step === 0 && !validateStep1()) return;
    if (step === 1 && !validateStep2()) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function handleBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setIsPending(true);
    setApiError("");

    try {
      const body: Record<string, unknown> = {
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        officialEmail: values.officialEmail.trim(),
        role: values.role,
        primaryUnitCode: values.primaryUnitCode,
        secondaryUnitCodes: values.secondaryUnitCodes,
        roleKeys: values.roleKeys,
      };
      if (canAssignPermissionRoles) {
        body.permissionRoleCodes = values.permissionRoleCodes;
      }
      if (values.employeeId.trim()) body.employeeId = values.employeeId.trim();
      if (values.designation.trim()) body.designation = values.designation.trim();
      if (values.dateOfJoining) body.dateOfJoining = values.dateOfJoining;

      const res = await fetch("/api/tenant/personnel/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();

      if (!res.ok || json.status === "error") {
        setApiError(json.message ?? "The request could not be completed.");
        return;
      }

      router.push("/tenant-admin/personnel?onboarded=1");
      router.refresh();
    } catch {
      setApiError("The request could not be completed.");
    } finally {
      setIsPending(false);
    }
  }

  // ── Lookup helpers for the review step ────────────────────────────────────
  const primaryUnit = units.find((u) => u.code === values.primaryUnitCode);
  const secondaryUnits = units.filter((u) => values.secondaryUnitCodes.includes(u.code));
  const selectedRoles = roles.filter((r) => values.roleKeys.includes(r.roleKey));
  const selectedPermissionRoles = permissionRoles.filter((role) =>
    values.permissionRoleCodes.includes(role.code),
  );

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            {i > 0 && <div className="h-px w-6 bg-slate-200" />}
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition ${
                i < step
                  ? "bg-slate-900 text-white"
                  : i === step
                    ? "bg-slate-900 text-white ring-2 ring-slate-900/20 ring-offset-2"
                    : "bg-slate-100 text-slate-400"
              }`}
            >
              {i + 1}
            </div>
            <span
              className={`hidden text-xs font-medium sm:inline ${
                i === step ? "text-slate-900" : "text-slate-400"
              }`}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* ── Step 1: User Details ─────────────────────────────────────────── */}
      {step === 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="First name"
            error={errors.firstName}
            input={
              <input
                className={inputClassName}
                value={values.firstName}
                onChange={(e) => set("firstName", e.target.value)}
              />
            }
          />
          <Field
            label="Last name"
            error={errors.lastName}
            input={
              <input
                className={inputClassName}
                value={values.lastName}
                onChange={(e) => set("lastName", e.target.value)}
              />
            }
          />
          <Field
            label="Email"
            error={errors.officialEmail}
            input={
              <input
                className={inputClassName}
                type="email"
                value={values.officialEmail}
                onChange={(e) => set("officialEmail", e.target.value)}
              />
            }
          />
          <Field
            label="Employee ID"
            input={
              <input
                className={inputClassName}
                value={values.employeeId}
                onChange={(e) => set("employeeId", e.target.value)}
                placeholder="Optional"
              />
            }
          />
          <Field
            label="Designation"
            input={
              <input
                className={inputClassName}
                value={values.designation}
                onChange={(e) => set("designation", e.target.value)}
                placeholder="Optional"
              />
            }
          />
          <Field
            label="Date of joining"
            input={
              <input
                className={inputClassName}
                type="date"
                value={values.dateOfJoining}
                onChange={(e) => set("dateOfJoining", e.target.value)}
              />
            }
          />
          <Field
            label="Role"
            input={
              <select
                className={inputClassName}
                value={values.role}
                onChange={(e) => set("role", e.target.value as FormValues["role"])}
              >
                <option value="TENANT_USER">Tenant User</option>
                {canCreateAdmin && <option value="TENANT_ADMIN">Tenant Admin</option>}
              </select>
            }
          />
        </div>
      )}

      {/* ── Step 2: Unit & Role Assignment ───────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-5">
          <Field
            label="Primary unit"
            error={errors.primaryUnitCode}
            input={
              <div className="space-y-2">
                <input
                  className={inputClassName}
                  placeholder="Search units..."
                  value={unitQuery}
                  onChange={(e) => setUnitQuery(e.target.value)}
                />
                <select
                  className={inputClassName}
                  value={values.primaryUnitCode}
                  onChange={(e) => {
                    set("primaryUnitCode", e.target.value);
                    set(
                      "secondaryUnitCodes",
                      values.secondaryUnitCodes.filter((c) => c !== e.target.value),
                    );
                  }}
                >
                  <option value="">Select a unit</option>
                  {filteredUnits.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            }
          />

          <Field
            label="Secondary units"
            input={
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {values.secondaryUnitCodes.map((code) => {
                    const u = units.find((x) => x.code === code);
                    return (
                      <span
                        key={code}
                        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
                      >
                        [{code}] {u?.name ?? code}
                        <button
                          type="button"
                          className="text-slate-400 transition hover:text-rose-500"
                          onClick={() =>
                            set(
                              "secondaryUnitCodes",
                              values.secondaryUnitCodes.filter((c) => c !== code),
                            )
                          }
                        >
                          &times;
                        </button>
                      </span>
                    );
                  })}
                </div>
                <select
                  className={inputClassName}
                  value=""
                  onChange={(e) => {
                    if (e.target.value && !values.secondaryUnitCodes.includes(e.target.value)) {
                      set("secondaryUnitCodes", [...values.secondaryUnitCodes, e.target.value]);
                    }
                  }}
                >
                  <option value="">Add secondary unit...</option>
                  {secondaryOptions.map((o) => (
                    <option
                      key={o.code}
                      value={o.code}
                      disabled={values.secondaryUnitCodes.includes(o.code)}
                    >
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            }
          />

          <Field
            label="Org roles"
            input={
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {values.roleKeys.map((key) => {
                    const r = roles.find((x) => x.roleKey === key);
                    return (
                      <span
                        key={key}
                        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
                      >
                        [{key}] {r?.displayLabel ?? key}
                        {r?.isUnitHead && (
                          <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-bold text-amber-700">
                            Head
                          </span>
                        )}
                        <button
                          type="button"
                          className="text-slate-400 transition hover:text-rose-500"
                          onClick={() =>
                            set(
                              "roleKeys",
                              values.roleKeys.filter((k) => k !== key),
                            )
                          }
                        >
                          &times;
                        </button>
                      </span>
                    );
                  })}
                </div>
                <select
                  className={inputClassName}
                  value=""
                  onChange={(e) => {
                    if (e.target.value && !values.roleKeys.includes(e.target.value)) {
                      set("roleKeys", [...values.roleKeys, e.target.value]);
                    }
                  }}
                >
                  <option value="">Add a role...</option>
                  {roles.map((r) => (
                    <option
                      key={r.roleKey}
                      value={r.roleKey}
                      disabled={values.roleKeys.includes(r.roleKey)}
                    >
                      [{r.roleKey}] {r.displayLabel}
                      {r.isUnitHead ? " (Head)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            }
          />

          {canAssignPermissionRoles ? (
            <Field
              label="Permission roles"
              input={
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {values.permissionRoleCodes.map((code) => {
                      const role = permissionRoles.find((entry) => entry.code === code);
                      return (
                        <span
                          key={code}
                          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
                        >
                          {role?.label ?? code}
                          <button
                            type="button"
                            className="text-slate-400 transition hover:text-rose-500"
                            onClick={() =>
                              set(
                                "permissionRoleCodes",
                                values.permissionRoleCodes.filter((value) => value !== code),
                              )
                            }
                          >
                            &times;
                          </button>
                        </span>
                      );
                    })}
                  </div>
                  <select
                    className={inputClassName}
                    value=""
                    onChange={(e) => {
                      const value = e.target.value as FormValues["permissionRoleCodes"][number];
                      if (value && !values.permissionRoleCodes.includes(value)) {
                        set("permissionRoleCodes", [...values.permissionRoleCodes, value]);
                      }
                    }}
                  >
                    <option value="">Add a permission role...</option>
                    {permissionRoles.map((role) => (
                      <option
                        key={role.code}
                        value={role.code}
                        disabled={values.permissionRoleCodes.includes(role.code)}
                      >
                        {role.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500">
                    Permission roles are additive and do not replace the user&apos;s base tenant role.
                  </p>
                </div>
              }
            />
          ) : null}
        </div>
      )}

      {/* ── Step 3: Review & Confirm ─────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          <ReviewSection title="User Details">
            <ReviewRow label="Name" value={`${values.firstName} ${values.lastName}`} />
            <ReviewRow label="Email" value={values.officialEmail} />
            {values.employeeId && <ReviewRow label="Employee ID" value={values.employeeId} />}
            {values.designation && <ReviewRow label="Designation" value={values.designation} />}
            {values.dateOfJoining && <ReviewRow label="Date of Joining" value={values.dateOfJoining} />}
            <ReviewRow label="Role" value={values.role === "TENANT_ADMIN" ? "Tenant Admin" : "Tenant User"} />
          </ReviewSection>

          <ReviewSection title="Placement">
            <ReviewRow
              label="Primary unit"
              value={primaryUnit ? `[${primaryUnit.code}] ${primaryUnit.name}` : "—"}
            />
            <ReviewRow
              label="Secondary units"
              value={
                secondaryUnits.length
                  ? secondaryUnits.map((u) => `[${u.code}] ${u.name}`).join(", ")
                  : "None"
              }
            />
            <ReviewRow
              label="Org roles"
              value={
                selectedRoles.length
                  ? selectedRoles
                      .map((r) => `[${r.roleKey}] ${r.displayLabel}${r.isUnitHead ? " (Head)" : ""}`)
                      .join(", ")
                  : "None"
              }
            />
            {canAssignPermissionRoles ? (
              <ReviewRow
                label="Permission roles"
                value={
                  selectedPermissionRoles.length
                    ? selectedPermissionRoles.map((role) => role.label).join(", ")
                    : "None"
                }
              />
            ) : null}
          </ReviewSection>
        </div>
      )}

      {/* Error banner */}
      {apiError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {apiError}
        </div>
      )}

      {/* Navigation buttons */}
      <div className="flex items-center gap-3">
        {step > 0 && (
          <button
            type="button"
            className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
            onClick={handleBack}
          >
            Previous
          </button>
        )}
        {step < STEPS.length - 1 && (
          <button
            type="button"
            className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            onClick={handleNext}
          >
            Next
          </button>
        )}
        {step === STEPS.length - 1 && (
          <button
            type="button"
            className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            disabled={isPending}
            onClick={handleSubmit}
          >
            {isPending ? "Submitting..." : "Confirm & Onboard"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Private helpers ─────────────────────────────────────────────────────────

type UnitOption = { code: string; label: string; search: string };

function buildUnitOptions(units: Props["units"]): UnitOption[] {
  return units.map((u) => {
    const indent = u.level > 0 ? "\u00A0\u00A0".repeat(u.level) : "";
    return {
      code: u.code,
      label: `${indent}[${u.code}] ${u.name}`,
      search: `${u.code} ${u.name} ${u.typeName}`.toLowerCase(),
    };
  });
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

function ReviewSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">{title}</h3>
      <dl className="space-y-2">{children}</dl>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-32 shrink-0 font-medium text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  );
}
