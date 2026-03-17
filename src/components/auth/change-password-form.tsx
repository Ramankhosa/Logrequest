"use client";

import { useActionState } from "react";
import { changePasswordAction, initialAuthActionState } from "@/lib/auth/actions";

export function ChangePasswordForm() {
  const [state, action, isPending] = useActionState(
    changePasswordAction,
    initialAuthActionState,
  );

  return (
    <form action={action} className="space-y-4">
      <label className="space-y-2">
        <span className="text-sm font-semibold text-slate-800">Current password</span>
        <input
          className={inputClassName}
          name="currentPassword"
          type="password"
          required
        />
      </label>

      <label className="space-y-2">
        <span className="text-sm font-semibold text-slate-800">New password</span>
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
        {isPending ? "Updating..." : "Change password"}
      </button>
    </form>
  );
}

const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900";
