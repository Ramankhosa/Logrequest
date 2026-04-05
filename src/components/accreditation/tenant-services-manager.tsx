"use client";

import { useState } from "react";

type TenantServiceRow = {
  serviceCode: "ACCREDITATION";
  status: "ENABLED" | "DISABLED";
  enabledAt: string | Date | null;
  disabledAt: string | Date | null;
  notes: string | null;
};

type TenantFeatureRow = {
  featureCode: "ACCREDITATION_COPILOT";
  status: "ENABLED" | "DISABLED";
  enabledAt: string | Date | null;
  disabledAt: string | Date | null;
  notes: string | null;
};

type TenantRow = {
  id: string;
  name: string;
  code: string;
  subscriptionPlan: string;
  lifecycleState: string;
  entitlementState: string;
  services: TenantServiceRow[];
  features: TenantFeatureRow[];
};

function normalizeTenantRow(row: TenantRow): TenantRow {
  return {
    ...row,
    services: row.services ?? [],
    features: row.features ?? [],
  };
}

export function TenantServicesManager({
  initialTenants,
}: {
  initialTenants: TenantRow[];
}) {
  const [tenants, setTenants] = useState<TenantRow[]>(
    initialTenants.map(normalizeTenantRow),
  );
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function refreshTenants() {
    setLoading(true);
    try {
      const response = await fetch("/api/superadmin/tenants", { cache: "no-store" });
      const data = (await response.json()) as {
        status: "success" | "error";
        message?: string;
        tenants?: TenantRow[];
      };
      if (!response.ok || data.status !== "success") {
        throw new Error(data.message ?? "Failed to refresh tenants.");
      }
      setTenants((data.tenants ?? []).map(normalizeTenantRow));
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to refresh tenants.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function toggleAccreditation(tenant: TenantRow, enabled: boolean) {
    setActionId(tenant.id);
    try {
      const notes = window
        .prompt(
          enabled
            ? `Optional note for enabling accreditation on ${tenant.name}`
            : `Optional note for disabling accreditation on ${tenant.name}`,
          "",
        )
        ?.trim();

      const response = await fetch(
        `/api/superadmin/tenants/${tenant.id}/services/ACCREDITATION`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled,
            notes: notes && notes.length > 0 ? notes : null,
          }),
        },
      );
      const data = (await response.json()) as {
        status: "success" | "error";
        message?: string;
      };
      if (!response.ok || data.status !== "success") {
        throw new Error(data.message ?? "Failed to update accreditation service.");
      }
      setMessage({
        type: "success",
        text: data.message ?? "Tenant service updated.",
      });
      await refreshTenants();
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Failed to update accreditation service.",
      });
    } finally {
      setActionId(null);
    }
  }

  async function toggleAccreditationCopilot(tenant: TenantRow, enabled: boolean) {
    setActionId(`${tenant.id}:copilot`);
    try {
      const notes = window
        .prompt(
          enabled
            ? `Optional note for enabling accreditation copilot on ${tenant.name}`
            : `Optional note for disabling accreditation copilot on ${tenant.name}`,
          "",
        )
        ?.trim();

      const response = await fetch(
        `/api/superadmin/tenants/${tenant.id}/features/ACCREDITATION_COPILOT`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled,
            notes: notes && notes.length > 0 ? notes : null,
          }),
        },
      );
      const data = (await response.json()) as {
        status: "success" | "error";
        message?: string;
      };
      if (!response.ok || data.status !== "success") {
        throw new Error(data.message ?? "Failed to update accreditation copilot feature.");
      }
      setMessage({
        type: "success",
        text: data.message ?? "Tenant feature updated.",
      });
      await refreshTenants();
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Failed to update accreditation copilot feature.",
      });
    } finally {
      setActionId(null);
    }
  }

  return (
    <div className="space-y-5">
      {message ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            message.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Tenant Services</h2>
          <p className="text-sm text-slate-500">
            Control the accreditation add-on and its tenant-level copilot feature.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshTenants()}
          disabled={loading}
          className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Tenant
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Plan
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Lifecycle
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Entitlement
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Accreditation
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Copilot
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {tenants.map((tenant) => {
                const accreditation = tenant.services.find(
                  (service) => service.serviceCode === "ACCREDITATION",
                );
                const copilot = tenant.features.find(
                  (feature) => feature.featureCode === "ACCREDITATION_COPILOT",
                );
                const enabled = accreditation?.status === "ENABLED";
                const copilotEnabled = copilot?.status === "ENABLED" && enabled;

                return (
                  <tr key={tenant.id}>
                    <td className="px-4 py-4">
                      <div className="font-semibold text-slate-900">{tenant.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{tenant.code}</div>
                    </td>
                    <td className="px-4 py-4 text-slate-700">{tenant.subscriptionPlan}</td>
                    <td className="px-4 py-4 text-slate-700">{tenant.lifecycleState}</td>
                    <td className="px-4 py-4 text-slate-700">{tenant.entitlementState}</td>
                    <td className="px-4 py-4">
                      <div
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                          enabled
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {enabled ? "Enabled" : "Disabled"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {enabled
                          ? accreditation?.enabledAt
                            ? `Enabled ${new Date(accreditation.enabledAt).toLocaleString()}`
                            : "Enabled"
                          : accreditation?.disabledAt
                            ? `Disabled ${new Date(accreditation.disabledAt).toLocaleString()}`
                            : "Not provisioned"}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                          copilotEnabled
                            ? "bg-emerald-100 text-emerald-700"
                            : enabled
                              ? "bg-amber-100 text-amber-700"
                              : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {copilotEnabled
                          ? "Enabled"
                          : enabled
                            ? "Feature disabled"
                            : "Service disabled"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {enabled
                          ? copilot?.enabledAt
                            ? `Enabled ${new Date(copilot.enabledAt).toLocaleString()}`
                            : "Not provisioned"
                          : "Unavailable until accreditation is enabled"}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={actionId === tenant.id}
                          onClick={() => void toggleAccreditation(tenant, !enabled)}
                          className={`rounded-full px-4 py-2 text-xs font-semibold disabled:opacity-60 ${
                            enabled
                              ? "border border-rose-200 bg-rose-50 text-rose-700"
                              : "border border-emerald-200 bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {actionId === tenant.id
                            ? "Saving..."
                            : enabled
                              ? "Disable"
                              : "Enable"}
                        </button>
                        <button
                          type="button"
                          disabled={!enabled || actionId === `${tenant.id}:copilot`}
                          onClick={() => void toggleAccreditationCopilot(tenant, !copilotEnabled)}
                          className={`rounded-full px-4 py-2 text-xs font-semibold disabled:opacity-60 ${
                            copilotEnabled
                              ? "border border-rose-200 bg-rose-50 text-rose-700"
                              : "border border-indigo-200 bg-indigo-50 text-indigo-700"
                          }`}
                        >
                          {actionId === `${tenant.id}:copilot`
                            ? "Saving..."
                            : copilotEnabled
                              ? "Disable Copilot"
                              : "Enable Copilot"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {tenants.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    No tenants found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
