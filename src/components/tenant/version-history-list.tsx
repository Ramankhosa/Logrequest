"use client";

import { useEffect, useState } from "react";
import {
  Clock,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  FileEdit,
  Archive,
  AlertCircle,
  GitBranch,
} from "lucide-react";

type VersionEntry = {
  id: string;
  name: string;
  versionNumber: number;
  state: string;
  publishedAt: string | null;
  createdAt: string;
  unitTypeCount: number;
  unitCount: number;
};

type VersionDetail = {
  version: VersionEntry;
  unitTypes: Array<{
    id: string;
    typeKey: string;
    displayLabel: string;
  }>;
  units: Array<{
    id: string;
    code: string;
    name: string;
    parentId: string | null;
    level: number;
    state: string;
    typeLabel: string;
    typeKey: string;
  }>;
};

const STATE_CONFIG: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; class: string; label: string }
> = {
  PUBLISHED: {
    icon: CheckCircle2,
    class: "bg-brand/10 text-brand border-brand/20",
    label: "Published",
  },
  DRAFT: {
    icon: FileEdit,
    class: "bg-amber-50 text-amber-600 border-amber-200",
    label: "Draft",
  },
  VALIDATED: {
    icon: CheckCircle2,
    class: "bg-blue-50 text-blue-600 border-blue-200",
    label: "Validated",
  },
  SUPERSEDED: {
    icon: Archive,
    class: "bg-slate-100 text-slate-500 border-slate-200",
    label: "Superseded",
  },
  ARCHIVED: {
    icon: Archive,
    class: "bg-slate-100 text-slate-400 border-slate-200",
    label: "Archived",
  },
};

export function VersionHistoryList() {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    const fetchVersions = async () => {
      try {
        const res = await fetch("/api/tenant/structure/versions");
        const data = await res.json();
        if (data.status === "success") {
          setVersions(data.data);
        } else {
          setError(data.message ?? "Failed to load versions.");
        }
      } catch {
        setError("Failed to load version history.");
      } finally {
        setLoading(false);
      }
    };
    void fetchVersions();
  }, []);

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }

    setExpandedId(id);
    setDetail(null);
    setDetailLoading(true);

    try {
      const res = await fetch(`/api/tenant/structure/versions/${id}`);
      const data = await res.json();
      if (data.status === "success") {
        setDetail(data.data);
      }
    } catch {
      // silently fail, user can re-expand
    } finally {
      setDetailLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {error}
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 py-12 text-center">
        <Clock className="h-8 w-8 text-slate-300" />
        <p className="text-sm font-medium text-slate-500">
          No versions yet
        </p>
        <p className="text-xs text-slate-400">
          Versions are created when you start building your org structure
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {versions.map((v) => {
        const config = STATE_CONFIG[v.state] ?? STATE_CONFIG.ARCHIVED;
        const Icon = config.icon;
        const isExpanded = expandedId === v.id;

        return (
          <div
            key={v.id}
            className="rounded-xl border border-slate-200/80 bg-white overflow-hidden"
          >
            {/* Version row */}
            <button
              type="button"
              onClick={() => handleExpand(v.id)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50/80"
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-slate-400">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">
                    {v.name}
                  </span>
                  <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                    v{v.versionNumber}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-400">
                  <span>{v.unitCount} unit(s)</span>
                  <span>{v.unitTypeCount} type(s)</span>
                  {v.publishedAt ? (
                    <span>
                      Published{" "}
                      {new Date(v.publishedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  ) : (
                    <span>
                      Created{" "}
                      {new Date(v.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  )}
                </div>
              </div>

              <span
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${config.class}`}
              >
                <Icon className="h-3 w-3" />
                {config.label}
              </span>
            </button>

            {/* Expanded detail */}
            {isExpanded ? (
              <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-4">
                {detailLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                  </div>
                ) : detail ? (
                  <div className="space-y-3">
                    {/* Unit types */}
                    {detail.unitTypes.length > 0 ? (
                      <div>
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Unit types
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {detail.unitTypes.map((t) => (
                            <span
                              key={t.id}
                              className="rounded-lg bg-white border border-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600"
                            >
                              {t.displayLabel}{" "}
                              <span className="text-slate-400">
                                ({t.typeKey})
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {/* Mini tree */}
                    {detail.units.length > 0 ? (
                      <div>
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Units ({detail.units.length})
                        </div>
                        <div className="max-h-60 overflow-auto rounded-lg border border-slate-200 bg-white">
                          <ul className="divide-y divide-slate-50 py-1">
                            {detail.units.map((u) => (
                              <li
                                key={u.id}
                                className={`flex items-center gap-2 px-3 py-1.5 ${
                                  u.state === "INACTIVE" ? "opacity-50" : ""
                                }`}
                                style={{
                                  paddingLeft: `${12 + u.level * 16}px`,
                                }}
                              >
                                <GitBranch className="h-3 w-3 shrink-0 text-slate-300" />
                                <span
                                  className={`text-xs font-medium ${
                                    u.state === "INACTIVE"
                                      ? "text-slate-400 line-through"
                                      : "text-slate-800"
                                  }`}
                                >
                                  {u.name}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {u.code}
                                </span>
                                <span className="ml-auto text-[10px] text-slate-400">
                                  {u.typeLabel}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">
                        No units in this version.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">
                    Failed to load details.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
