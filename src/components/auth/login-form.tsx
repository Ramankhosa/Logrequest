"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { signIn, signOut } from "next-auth/react";

type LoginFormProps = {
  callbackUrl?: string;
  error?: string;
  invalidateSession?: boolean;
  googleEnabled: boolean;
  microsoftEnabled: boolean;
};

export function LoginForm({
  callbackUrl,
  error,
  invalidateSession = false,
  googleEnabled,
  microsoftEnabled,
}: LoginFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState(error ?? "");

  useEffect(() => {
    if (!invalidateSession) {
      return;
    }

    void signOut({ redirect: false });
  }, [invalidateSession]);

  return (
    <div className="glass-panel mx-auto w-full max-w-md rounded-[2rem] border p-6 sm:p-8">
      <div className="mb-6 space-y-2">
        <span className="section-title text-xs text-slate-500">Sign In</span>
        <h1 className="font-[family-name:var(--font-geist-mono)] text-3xl text-slate-950">
          Access your workspace
        </h1>
        <p className="text-sm leading-7 text-slate-600">
          Use your approved email and password, or a configured social account.
        </p>
      </div>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const email = String(formData.get("email") ?? "");
          const password = String(formData.get("password") ?? "");
          const tenantCode = String(formData.get("tenantCode") ?? "");

          startTransition(async () => {
            setFormError("");

            const response = await signIn("credentials", {
              email,
              password,
              tenantCode,
              redirect: false,
              callbackUrl: callbackUrl ?? "/post-auth",
            });

            if (!response?.ok) {
              setFormError(response?.error ?? "Login failed.");
              return;
            }

            router.push(response.url ?? "/post-auth");
            router.refresh();
          });
        }}
      >
        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-800">Email</span>
          <input
            className={inputClassName}
            name="email"
            type="email"
            placeholder="you@organization.com"
            required
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-800">Password</span>
          <input
            className={inputClassName}
            name="password"
            type="password"
            placeholder="Your password"
            required
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-800">
            Tenant code
          </span>
          <input
            className={inputClassName}
            name="tenantCode"
            type="text"
            placeholder="Optional if you have one active organization"
          />
        </label>

        {formError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {decodeURIComponent(formError)}
          </div>
        ) : null}

        <button
          className="w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          type="submit"
          disabled={isPending}
        >
          {isPending ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <div className="my-6 h-px bg-slate-200" />

      <div className="space-y-3">
        {googleEnabled ? (
          <button
            className="w-full rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
            onClick={() => signIn("google", { callbackUrl: callbackUrl ?? "/post-auth" })}
            type="button"
          >
            Sign in with Google
          </button>
        ) : null}

        {microsoftEnabled ? (
          <button
            className="w-full rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
            onClick={() =>
              signIn("azure-ad", { callbackUrl: callbackUrl ?? "/post-auth" })
            }
            type="button"
          >
            Sign in with Microsoft
          </button>
        ) : null}
      </div>

      <div className="mt-6 flex items-center justify-between gap-4 text-sm text-slate-600">
        <Link className="font-semibold text-brand" href="/forgot-password">
          Forgot password
        </Link>
        <span>Use your invitation link to activate first access.</span>
      </div>
    </div>
  );
}

const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900";
