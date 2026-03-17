"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  initialOrgStructureActionResult,
  type OrgStructureActionResult,
} from "@/lib/org-structure/shared";

type ActionButtonProps = {
  label: string;
  path: string;
};

export function StructureSummaryActions() {
  const [result, setResult] = useState<OrgStructureActionResult>(
    initialOrgStructureActionResult,
  );
  const [isPending, setPending] = useState(false);
  const router = useRouter();

  const sendAction = async (
    endpoint: string,
    options?: { refresh?: boolean },
  ) => {
    setPending(true);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const payload = (await response.json()) as OrgStructureActionResult;
      setResult(payload);
    } catch {
      setResult({
        status: "error",
        message: "The server request failed.",
      });
    } finally {
      setPending(false);
      if (options?.refresh) {
        router.refresh();
      }
    }
  };

  const handlePublish = () => {
    if (
      !window.confirm(
        "Publish this draft? This will replace the current published structure.",
      )
    ) {
      return;
    }
    void sendAction("/api/tenant/structure/publish", { refresh: true });
  };

  const handleDiscard = () => {
    if (
      !window.confirm(
        "Discard this draft? All unpublished changes will be lost.",
      )
    ) {
      return;
    }
    void sendAction("/api/tenant/structure/discard", { refresh: true });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StructureActionButton
          label="Create type"
          path="/tenant-admin/structure/types/new"
        />
        <StructureActionButton
          label="Create unit"
          path="/tenant-admin/structure/units/new"
        />
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            sendAction("/api/tenant/structure/validate", { refresh: true })
          }
          className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:border-slate-400 disabled:opacity-50"
        >
          Validate draft
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={handleDiscard}
          className="rounded-full border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:border-rose-300 disabled:opacity-50"
        >
          Discard draft
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={handlePublish}
          className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          Publish
        </button>
      </div>
      {result.status !== "idle" ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            result.status === "success"
              ? "border-brand/20 bg-brand-soft text-brand"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {result.message}
        </div>
      ) : null}
    </div>
  );
}

function StructureActionButton({ label, path }: ActionButtonProps) {
  return (
    <Link
      href={path}
      className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300"
    >
      {label}
    </Link>
  );
}
