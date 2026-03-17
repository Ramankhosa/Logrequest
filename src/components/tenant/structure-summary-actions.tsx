"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Trash2,
  Upload,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  initialOrgStructureActionResult,
  type OrgStructureActionResult,
} from "@/lib/org-structure/shared";

export function StructureSummaryActions() {
  const [result, setResult] = useState<OrgStructureActionResult>(
    initialOrgStructureActionResult,
  );
  const [isPending, setPending] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const router = useRouter();

  const sendAction = async (
    endpoint: string,
    action: string,
    options?: { refresh?: boolean },
  ) => {
    setPending(true);
    setPendingAction(action);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = (await response.json()) as OrgStructureActionResult;
      setResult(payload);
    } catch {
      setResult({ status: "error", message: "The server request failed." });
    } finally {
      setPending(false);
      setPendingAction(null);
      if (options?.refresh) router.refresh();
    }
  };

  const handlePublish = () => {
    if (
      !window.confirm(
        "Publish this draft? This will replace the current published structure.",
      )
    )
      return;
    void sendAction("/api/tenant/structure/publish", "publish", {
      refresh: true,
    });
  };

  const handleDiscard = () => {
    if (
      !window.confirm(
        "Discard this draft? All unpublished changes will be lost.",
      )
    )
      return;
    void sendAction("/api/tenant/structure/discard", "discard", {
      refresh: true,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {/* Validate */}
        <ActionButton
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Validate draft"
          loading={isPending && pendingAction === "validate"}
          disabled={isPending}
          tone="default"
          onClick={() =>
            sendAction("/api/tenant/structure/validate", "validate", {
              refresh: true,
            })
          }
        />

        {/* Discard */}
        <ActionButton
          icon={<Trash2 className="h-4 w-4" />}
          label="Discard draft"
          loading={isPending && pendingAction === "discard"}
          disabled={isPending}
          tone="danger"
          onClick={handleDiscard}
        />

        {/* Publish */}
        <ActionButton
          icon={<Upload className="h-4 w-4" />}
          label="Publish"
          loading={isPending && pendingAction === "publish"}
          disabled={isPending}
          tone="primary"
          onClick={handlePublish}
        />
      </div>

      {/* Feedback message */}
      {result.status !== "idle" ? (
        <div
          className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
            result.status === "success"
              ? "border-brand/20 bg-brand/5 text-brand"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {result.status === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{result.message}</span>
        </div>
      ) : null}
    </div>
  );
}

type Tone = "default" | "danger" | "primary";

function ActionButton({
  icon,
  label,
  loading,
  disabled,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  loading: boolean;
  disabled: boolean;
  tone: Tone;
  onClick?: () => void;
}) {
  const toneClasses: Record<Tone, string> = {
    default:
      "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
    danger:
      "border border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100",
    primary:
      "border border-transparent bg-slate-950 text-white hover:bg-slate-800",
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${toneClasses[tone]}`}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        icon
      )}
      {label}
    </button>
  );
}
