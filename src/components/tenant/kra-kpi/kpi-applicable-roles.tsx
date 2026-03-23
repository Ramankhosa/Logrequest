"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, Users } from "lucide-react";

type TenantRole = {
  id: string;
  code: string;
  name: string;
  defaultCreditPercent: number;
  isActive: boolean;
  sortOrder: number;
};

type LinkedRole = TenantRole & {
  linkIsDefault: boolean;
  linkSortOrder: number;
};

export function KpiApplicableRoles({ kpiDefinitionId }: { kpiDefinitionId: string }) {
  const [pool, setPool] = useState<TenantRole[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [defaultRoleId, setDefaultRoleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [poolRes, linkRes] = await Promise.all([
        fetch("/api/tenant/kra-kpi/contributor-roles"),
        fetch(`/api/tenant/kra-kpi/kpis/${kpiDefinitionId}/applicable-roles`),
      ]);
      const poolData = (await poolRes.json()) as TenantRole[];
      const linkData = (await linkRes.json()) as LinkedRole[];
      if (!Array.isArray(poolData)) {
        setError("Could not load tenant contributor roles.");
        return;
      }
      setPool(poolData.filter((r) => r.isActive));
      if (Array.isArray(linkData) && linkData.length > 0) {
        const ids = new Set(linkData.map((r) => r.id));
        setEnabled(ids);
        const def = linkData.find((r) => r.linkIsDefault);
        setDefaultRoleId(def?.id ?? [...ids][0] ?? null);
      } else {
        setEnabled(new Set());
        setDefaultRoleId(null);
      }
    } catch {
      setError("Failed to load applicable roles.");
    } finally {
      setLoading(false);
    }
  }, [kpiDefinitionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleRole = (id: string, on: boolean) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      if (!on && defaultRoleId === id) {
        const first = [...next][0];
        setDefaultRoleId(first ?? null);
      } else if (on && next.size === 1) {
        setDefaultRoleId(id);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setFeedback(null);
    setError(null);
    const selected = pool.filter((r) => enabled.has(r.id));
    if (selected.length === 0) {
      setError("Select at least one applicable role.");
      return;
    }
    if (!defaultRoleId) {
      setError("Choose a default role among the selected roles.");
      return;
    }
    if (!selected.some((r) => r.id === defaultRoleId)) {
      setError("Default role must be one of the selected roles.");
      return;
    }
    setSaving(true);
    try {
      const roles = selected.map((r, i) => ({
        roleId: r.id,
        isDefault: r.id === defaultRoleId,
        sortOrder: i,
      }));
      const res = await fetch(`/api/tenant/kra-kpi/kpis/${kpiDefinitionId}/applicable-roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles }),
      });
      const data = await res.json();
      if (data.status === "error") {
        setError(data.message);
      } else {
        setFeedback(data.message ?? "Saved.");
        setTimeout(() => setFeedback(null), 3000);
        void load();
      }
    } catch {
      setError("Save failed.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading contributor roles…
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-slate-500" />
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Applicable contributor roles
        </p>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Choose which tenant roles can appear on this KPI&apos;s achievements. Every KPI must keep at least
        one applicable role, and exactly one role must be the default reporter.
      </p>
      {pool.length === 0 ? (
        <p className="text-xs text-slate-400">No active contributor roles in this tenant. Add roles under the Contributor Roles tab.</p>
      ) : (
        <ul className="space-y-2">
          {pool.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm"
            >
              <label className="inline-flex flex-1 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={enabled.has(r.id)}
                  onChange={(e) => toggleRole(r.id, e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-brand focus:ring-brand/30"
                />
                <span className="font-medium text-slate-800">{r.name}</span>
                <span className="font-mono text-[10px] uppercase text-slate-400">{r.code}</span>
                <span className="text-[10px] text-slate-400">def {r.defaultCreditPercent}%</span>
              </label>
              {enabled.has(r.id) && (
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                  <input
                    type="radio"
                    name={`kpi-default-role-${kpiDefinitionId}`}
                    checked={defaultRoleId === r.id}
                    onChange={() => setDefaultRoleId(r.id)}
                    className="h-3.5 w-3.5 border-slate-300 text-brand focus:ring-brand/30"
                  />
                  Default
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-rose-600">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </div>
      )}
      {feedback && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700">
          <CheckCircle2 className="h-3 w-3 shrink-0" />
          {feedback}
        </div>
      )}
      {pool.length > 0 && (
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Save applicable roles
        </button>
      )}
    </div>
  );
}
