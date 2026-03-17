"use client";

import Link from "next/link";
import { useActionState } from "react";
import { activateInvitationAction, initialAuthActionState } from "@/lib/auth/actions";

export function ActivationForm({ token }: { token: string }) {
  const [state, action, isPending] = useActionState(
    activateInvitationAction,
    initialAuthActionState,
  );

  return (
    <form action={action} className="space-y-4">
      <input name="token" type="hidden" value={token} />

      <label className="space-y-2">
        <span className="text-sm font-semibold text-slate-800">Create password</span>
        <input
          className={inputClassName}
          name="password"
          type="password"
          required
        />
      </label>

      <label className="space-y-2">
        <span className="text-sm font-semibold text-slate-800">Confirm password</span>
        <input
          className={inputClassName}
          name="confirmPassword"
          type="password"
          required
        />
      </label>

      {state.message ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            state.status === "error"
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-brand/15 bg-brand-soft/70 text-brand"
          }`}
        >
          {state.message}
        </div>
      ) : null}

      <button
        className="w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
        type="submit"
        disabled={isPending}
      >
        {isPending ? "Activating..." : "Activate account"}
      </button>

      {state.status === "success" ? (
        <Link className="block text-center text-sm font-semibold text-brand" href="/login">
          Continue to login
        </Link>
      ) : null}
    </form>
  );
}

const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900";
