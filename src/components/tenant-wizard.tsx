"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { z } from "zod";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import {
  initialTenantCreationResult,
  type TenantCreationResult,
} from "@/lib/superadmin/shared";

const formSchema = z
  .object({
    tenantName: z.string().trim().min(2, "Tenant name is required."),
    tenantCode: z
      .string()
      .trim()
      .min(3, "Tenant code is required.")
      .regex(/^[A-Z0-9_-]+$/, "Use uppercase letters, numbers, hyphen, or underscore."),
    legalOrganizationName: z
      .string()
      .trim()
      .min(3, "Legal organization name is required."),
    organizationType: z.string().trim().min(2, "Select an organization type."),
    primaryDomain: z.string().trim().min(3, "Primary domain is required."),
    subscriptionPlan: z.string().trim().min(2, "Subscription plan is required."),
    subscriptionStartDate: z.string().trim().min(1, "Start date is required."),
    subscriptionEndDate: z.string().trim().min(1, "End date is required."),
    lifecycleState: z.string().trim().min(1, "Lifecycle state is required."),
    entitlementState: z.string().trim().min(1, "Entitlement state is required."),
    accreditationEnabled: z.boolean(),
    ownerName: z.string().trim().min(2, "Owner name is required."),
    ownerEmail: z.string().trim().email("Enter a valid owner email."),
    allowGracePeriodAccess: z.boolean(),
    notifyOwnerImmediately: z.boolean(),
    requireExactSocialMatch: z.boolean(),
  });

type TenantWizardForm = z.infer<typeof formSchema>;
type FieldName = keyof TenantWizardForm;

type SubmittedSummary = {
  tenantName: string;
  tenantCode: string;
  ownerName: string;
  ownerEmail: string;
  subscriptionPlan: string;
  lifecycleState: string;
  entitlementState: string;
  accreditationEnabled: boolean;
  notifyOwnerImmediately: boolean;
};

const steps: Array<{
  title: string;
  fields: FieldName[];
}> = [
  {
    title: "Organization",
    fields: [
      "tenantName",
      "tenantCode",
      "legalOrganizationName",
      "organizationType",
      "primaryDomain",
    ],
  },
  {
    title: "Subscription",
    fields: [
      "subscriptionPlan",
      "subscriptionStartDate",
      "subscriptionEndDate",
      "lifecycleState",
      "entitlementState",
    ],
  },
  {
    title: "Tenant owner",
    fields: ["ownerName", "ownerEmail"],
  },
  {
    title: "Activation",
    fields: [
      "allowGracePeriodAccess",
      "accreditationEnabled",
      "notifyOwnerImmediately",
      "requireExactSocialMatch",
    ],
  },
  {
    title: "Review",
    fields: [],
  },
];

const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900";

export function TenantWizard() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [submittedSummary, setSubmittedSummary] = useState<SubmittedSummary | null>(null);
  const [result, setResult] = useState<TenantCreationResult>(initialTenantCreationResult);
  const [isPending, startTransition] = useTransition();

  const form = useForm<TenantWizardForm>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tenantName: "",
      tenantCode: "",
      legalOrganizationName: "",
      organizationType: "",
      primaryDomain: "",
      subscriptionPlan: "",
      subscriptionStartDate: "",
      subscriptionEndDate: "",
      lifecycleState: "",
      entitlementState: "",
      accreditationEnabled: false,
      ownerName: "",
      ownerEmail: "",
      allowGracePeriodAccess: true,
      notifyOwnerImmediately: true,
      requireExactSocialMatch: true,
    },
    mode: "onChange",
  });

  const currentStep = steps[stepIndex];
  const allowGracePeriodAccess = useWatch({
    control: form.control,
    name: "allowGracePeriodAccess",
  });
  const notifyOwnerImmediately = useWatch({
    control: form.control,
    name: "notifyOwnerImmediately",
  });
  const accreditationEnabled = useWatch({
    control: form.control,
    name: "accreditationEnabled",
  });
  const requireExactSocialMatch = useWatch({
    control: form.control,
    name: "requireExactSocialMatch",
  });
  const lifecycleState = useWatch({
    control: form.control,
    name: "lifecycleState",
  });
  const entitlementState = useWatch({
    control: form.control,
    name: "entitlementState",
  });
  const formValues = (useWatch({
    control: form.control,
  }) ?? {}) as Partial<TenantWizardForm>;

  const ownerCanSignIn = calculateOwnerAccess({
    lifecycleState,
    entitlementState,
    allowGracePeriodAccess,
  });

  const reviewValue = (value?: string) => (value && value.trim() ? value : "Not set");
  const reviewToggle = (value?: boolean) => (value ? "Enabled" : "Disabled");

  const nextStep = async () => {
    const isValid = await form.trigger(currentStep.fields);

    if (isValid) {
      setStepIndex((current) => Math.min(current + 1, steps.length - 1));
    }
  };

  const previousStep = () => {
    setStepIndex((current) => Math.max(current - 1, 0));
  };

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      setResult(initialTenantCreationResult);
      setSubmittedSummary(null);

      let actionResult: TenantCreationResult;

      try {
        const response = await fetch("/api/superadmin/tenants", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenantName: values.tenantName,
            tenantCode: values.tenantCode,
            legalOrganizationName: values.legalOrganizationName,
            organizationType: values.organizationType,
            primaryDomain: values.primaryDomain,
            subscriptionPlan: values.subscriptionPlan,
            subscriptionStartDate: values.subscriptionStartDate,
            subscriptionEndDate: values.subscriptionEndDate,
            lifecycleState: values.lifecycleState,
            entitlementState: values.entitlementState,
            accreditationEnabled: values.accreditationEnabled,
            ownerName: values.ownerName,
            ownerEmail: values.ownerEmail,
            allowGracePeriodAccess: values.allowGracePeriodAccess,
            notifyOwnerImmediately: values.notifyOwnerImmediately,
            requireExactSocialMatch: values.requireExactSocialMatch,
          }),
        });

        actionResult = (await response.json()) as TenantCreationResult;
      } catch {
        actionResult = {
          status: "error",
          message: "Tenant creation request failed before the server could confirm success.",
        };
      }

      setResult(actionResult);

      if (actionResult.status === "success") {
        router.refresh();
        setSubmittedSummary({
          tenantName: values.tenantName,
          tenantCode: actionResult.tenantCode ?? values.tenantCode,
          ownerName: values.ownerName,
          ownerEmail: actionResult.ownerEmail ?? values.ownerEmail,
          subscriptionPlan: values.subscriptionPlan,
          lifecycleState: values.lifecycleState,
          entitlementState: values.entitlementState,
          accreditationEnabled: values.accreditationEnabled,
          notifyOwnerImmediately: values.notifyOwnerImmediately,
        });
      }
    });
  });

  return (
    <Panel
      eyebrow="Create tenant"
      title="Tenant owner invite provisioning"
      description="All step data stays in the browser until the final submit. The database is touched only once, after the final validation succeeds."
    >
      <div className="mb-6 flex items-center justify-between gap-3 rounded-3xl border border-slate-200/80 bg-slate-50 px-4 py-3">
        <div className="text-sm text-slate-600">
          Use this dedicated page for final tenant creation.
        </div>
        <Link
          className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
          href="/superadmin"
        >
          Back to superadmin
        </Link>
      </div>

      <div className="mb-6 grid gap-3 md:grid-cols-5">
        {steps.map((step, index) => (
          <div
            key={step.title}
            className={`rounded-3xl border p-4 ${
              index === stepIndex
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200/80 bg-white/80 text-slate-700"
            }`}
          >
            <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em]">
              Step {index + 1}
            </div>
            <div className="text-sm font-semibold">{step.title}</div>
          </div>
        ))}
      </div>

      <form className="space-y-6" onSubmit={submit}>
        {stepIndex === 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              label="Tenant name"
              error={form.formState.errors.tenantName?.message}
              input={<input {...form.register("tenantName")} className={inputClassName} />}
            />
            <FormField
              label="Tenant code"
              error={form.formState.errors.tenantCode?.message}
              input={<input {...form.register("tenantCode")} className={inputClassName} />}
            />
            <FormField
              label="Legal organization name"
              error={form.formState.errors.legalOrganizationName?.message}
              input={
                <input
                  {...form.register("legalOrganizationName")}
                  className={inputClassName}
                />
              }
            />
            <FormField
              label="Organization type"
              error={form.formState.errors.organizationType?.message}
              input={
                <select {...form.register("organizationType")} className={inputClassName}>
                  <option value="" disabled>
                    Select organization type
                  </option>
                  <option value="University">University</option>
                  <option value="Research Institute">Research Institute</option>
                  <option value="Company">Company</option>
                  <option value="Academic Institution">Academic Institution</option>
                  <option value="Consortium">Consortium</option>
                </select>
              }
            />
            <FormField
              label="Primary domain"
              error={form.formState.errors.primaryDomain?.message}
              input={<input {...form.register("primaryDomain")} className={inputClassName} />}
            />
          </div>
        ) : null}

        {stepIndex === 1 ? (
          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              label="Subscription plan"
              error={form.formState.errors.subscriptionPlan?.message}
              input={<input {...form.register("subscriptionPlan")} className={inputClassName} />}
            />
            <FormField
              label="Lifecycle state"
              error={form.formState.errors.lifecycleState?.message}
              input={
                <select {...form.register("lifecycleState")} className={inputClassName}>
                  <option value="" disabled>
                    Select lifecycle state
                  </option>
                  <option value="DRAFT">Draft</option>
                  <option value="PENDING_VERIFICATION">Pending verification</option>
                  <option value="ACTIVE">Active</option>
                  <option value="GRACE_PERIOD">Grace period</option>
                  <option value="SUSPENDED">Suspended</option>
                </select>
              }
            />
            <FormField
              label="Subscription start"
              error={form.formState.errors.subscriptionStartDate?.message}
              input={
                <input
                  {...form.register("subscriptionStartDate")}
                  className={inputClassName}
                  type="date"
                />
              }
            />
            <FormField
              label="Subscription end"
              error={form.formState.errors.subscriptionEndDate?.message}
              input={
                <input
                  {...form.register("subscriptionEndDate")}
                  className={inputClassName}
                  type="date"
                />
              }
            />
            <FormField
              label="Entitlement state"
              error={form.formState.errors.entitlementState?.message}
              input={
                <select
                  {...form.register("entitlementState")}
                  className={inputClassName}
                >
                  <option value="" disabled>
                    Select entitlement state
                  </option>
                  <option value="TRIAL_ACTIVE">Trial active</option>
                  <option value="PAID_ACTIVE">Paid active</option>
                  <option value="GRACE_PERIOD">Grace period</option>
                  <option value="PAYMENT_HOLD">Payment hold</option>
                  <option value="SUSPENDED">Suspended</option>
                </select>
              }
            />
          </div>
        ) : null}

        {stepIndex === 2 ? (
          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              label="Tenant owner name"
              error={form.formState.errors.ownerName?.message}
              input={<input {...form.register("ownerName")} className={inputClassName} />}
            />
            <FormField
              label="Owner email"
              error={form.formState.errors.ownerEmail?.message}
              input={<input {...form.register("ownerEmail")} className={inputClassName} />}
            />

            <div className="rounded-3xl border border-slate-200/80 bg-slate-50 p-4 md:col-span-2">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldCheck className="h-4 w-4" />
                Owner-first governance
              </div>
              <p className="text-sm leading-7 text-slate-600">
                The tenant owner is invited to activate their account and set a
                password. After activation and sign-in, the owner provisions tenant
                admins and standard users from the tenant workspace.
              </p>
            </div>
          </div>
        ) : null}

        {stepIndex === 3 ? (
          <div className="grid gap-4 md:grid-cols-2">
            <ToggleCard
              label="Allow grace-period access"
              description="Users can keep restricted access while the subscription is under review."
              checked={allowGracePeriodAccess}
              input={<input {...form.register("allowGracePeriodAccess")} type="checkbox" />}
            />
            <ToggleCard
              label="Enable accreditation add-on"
              description="Provision the optional accreditation module for this tenant during creation."
              checked={accreditationEnabled}
              input={<input {...form.register("accreditationEnabled")} type="checkbox" />}
            />
            <ToggleCard
              label="Notify owner immediately"
              description="Send an activation email with a secure link to set a password."
              checked={notifyOwnerImmediately}
              input={<input {...form.register("notifyOwnerImmediately")} type="checkbox" />}
            />
            <ToggleCard
              label="Require exact social match"
              description="Allow Google or Microsoft sign-in only when the verified social email exactly matches the approved owner email."
              checked={requireExactSocialMatch}
              input={<input {...form.register("requireExactSocialMatch")} type="checkbox" />}
            />
            <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-900">
                Resulting initial state
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge label={lifecycleState} />
                <StatusBadge label={entitlementState} />
                <StatusBadge
                  label={
                    ownerCanSignIn
                      ? "Access allowed after activation"
                      : "Access blocked after activation"
                  }
                  tone={ownerCanSignIn ? "brand" : "amber"}
                />
              </div>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                {ownerCanSignIn
                  ? "An activation link is created for the owner. After activation, sign-in is allowed immediately."
                  : "An activation link is created for the owner, but sign-in remains blocked until tenant lifecycle and entitlement states allow access."}
              </p>
            </div>
          </div>
        ) : null}

        {stepIndex === 4 ? (
          <div className="space-y-4">
            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
              <div className="mb-2 text-sm font-semibold text-amber-900">
                Final review
              </div>
              <p className="text-sm leading-7 text-amber-900">
                Creating a tenant is irreversible. The owner will be invited to
                activate their account and set a password. Review every value
                before submitting.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <SummaryLine
                label="Tenant name"
                value={reviewValue(formValues.tenantName)}
              />
              <SummaryLine
                label="Tenant code"
                value={reviewValue(formValues.tenantCode)}
              />
              <SummaryLine
                label="Legal organization"
                value={reviewValue(formValues.legalOrganizationName)}
              />
              <SummaryLine
                label="Organization type"
                value={reviewValue(formValues.organizationType)}
              />
              <SummaryLine
                label="Primary domain"
                value={reviewValue(formValues.primaryDomain)}
              />
              <SummaryLine
                label="Subscription plan"
                value={reviewValue(formValues.subscriptionPlan)}
              />
              <SummaryLine
                label="Subscription window"
                value={`${reviewValue(formValues.subscriptionStartDate)} to ${reviewValue(
                  formValues.subscriptionEndDate,
                )}`}
              />
              <SummaryLine
                label="Lifecycle and entitlement"
                value={`${reviewValue(formValues.lifecycleState)} / ${reviewValue(
                  formValues.entitlementState,
                )}`}
              />
              <SummaryLine
                label="Owner"
                value={`${reviewValue(formValues.ownerName)} / ${reviewValue(
                  formValues.ownerEmail,
                )}`}
              />
              <SummaryLine
                label="Grace-period access"
                value={reviewToggle(formValues.allowGracePeriodAccess)}
              />
              <SummaryLine
                label="Accreditation service"
                value={reviewToggle(formValues.accreditationEnabled)}
              />
              <SummaryLine
                label="Notify owner immediately"
                value={reviewToggle(formValues.notifyOwnerImmediately)}
              />
              <SummaryLine
                label="Exact social match"
                value={reviewToggle(formValues.requireExactSocialMatch)}
              />
            </div>
            <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-4">
              <div className="mb-2 text-sm font-semibold text-slate-900">
                Invitation delivery
              </div>
              <p className="text-sm leading-7 text-slate-600">
                {notifyOwnerImmediately
                  ? "An activation link will be emailed to the owner immediately after the tenant is created."
                  : "No activation email will be sent automatically. The invitation token will still be created with a 7-day expiry."}
              </p>
            </div>
          </div>
        ) : null}

        {result.status === "error" ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {result.message}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-50"
            onClick={previousStep}
            type="button"
            disabled={stepIndex === 0 || isPending}
          >
            Back
          </button>

          {stepIndex < steps.length - 1 ? (
            <button
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              onClick={nextStep}
              type="button"
            >
              Continue
            </button>
          ) : (
            <button
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
              type="submit"
              disabled={isPending}
            >
              {isPending ? "Creating tenant..." : "Create tenant and invite owner"}
            </button>
          )}
        </div>
      </form>

      {submittedSummary && result.status === "success" ? (
        <div className="mt-6 rounded-[1.75rem] border border-brand/15 bg-brand-soft/70 p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand">
            <CheckCircle2 className="h-4 w-4" />
            Tenant created and owner invited
          </div>
          <p className="mb-4 text-sm leading-7 text-slate-700">{result.message}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <SummaryLine
              label="Tenant"
              value={`${submittedSummary.tenantName} (${submittedSummary.tenantCode})`}
            />
            <SummaryLine
              label="Subscription"
              value={`${submittedSummary.subscriptionPlan} / ${submittedSummary.entitlementState}`}
            />
            <SummaryLine
              label="Owner"
              value={`${submittedSummary.ownerName} / ${submittedSummary.ownerEmail}`}
            />
            <SummaryLine
              label="Access"
              value={
                result.ownerCanSignIn
                  ? "Owner must activate their account, then sign-in is allowed."
                  : "Owner must activate their account, but sign-in remains blocked until tenant access is enabled."
              }
            />
            <SummaryLine
              label="Accreditation service"
              value={submittedSummary.accreditationEnabled ? "Enabled" : "Disabled"}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusBadge label={submittedSummary.lifecycleState} />
            <StatusBadge label={submittedSummary.entitlementState} />
            <StatusBadge
              label={
                submittedSummary.notifyOwnerImmediately
                  ? "Invitation sent"
                  : "Invitation email skipped"
              }
              tone={submittedSummary.notifyOwnerImmediately ? "brand" : "slate"}
            />
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function FormField({
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

function ToggleCard({
  label,
  description,
  checked,
  input,
}: {
  label: string;
  description: string;
  checked: boolean;
  input: React.ReactNode;
}) {
  return (
    <label className="flex items-start gap-3 rounded-3xl border border-slate-200/80 bg-white/80 p-4">
      <span className="mt-1">{input}</span>
      <span>
        <span className="mb-1 block text-sm font-semibold text-slate-900">
          {label}
        </span>
        <span className="block text-sm leading-7 text-slate-600">
          {description}
        </span>
        <StatusBadge
          className="mt-3"
          label={checked ? "Enabled" : "Review required"}
          tone={checked ? "brand" : "amber"}
        />
      </span>
    </label>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/60 bg-white/70 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">
        {label}
      </div>
      <div className="mt-2 text-sm leading-7 text-slate-700">{value}</div>
    </div>
  );
}

function calculateOwnerAccess(input: {
  lifecycleState?: string;
  entitlementState?: string;
  allowGracePeriodAccess?: boolean;
}) {
  const allowGrace = Boolean(input.allowGracePeriodAccess);

  const lifecycleAllowed =
    input.lifecycleState === "ACTIVE" ||
    (input.lifecycleState === "GRACE_PERIOD" && allowGrace);

  const entitlementAllowed =
    input.entitlementState === "TRIAL_ACTIVE" ||
    input.entitlementState === "PAID_ACTIVE" ||
    (input.entitlementState === "GRACE_PERIOD" && allowGrace);

  return lifecycleAllowed && entitlementAllowed;
}
