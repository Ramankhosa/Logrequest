"use client";

import { useTransition } from "react";
import { signOut } from "next-auth/react";

export function SignOutButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-50"
      onClick={() => {
        startTransition(async () => {
          await signOut({
            callbackUrl: "/login",
          });
        });
      }}
      type="button"
      disabled={isPending}
    >
      {isPending ? "Signing out..." : "Sign out"}
    </button>
  );
}
