"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      className={
        className ??
        "rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-50"
      }
      onClick={() => {
        startTransition(async () => {
          await signOut({
            redirect: false,
            callbackUrl: "/login",
          });
          router.replace("/login");
          router.refresh();
        });
      }}
      type="button"
      disabled={isPending}
    >
      <LogOut className="h-3 w-3" />
      {isPending ? "Signing out…" : "Sign out"}
    </button>
  );
}
