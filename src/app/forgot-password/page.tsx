import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="surface-grid flex min-h-screen items-center justify-center px-4 py-8">
      <div className="glass-panel w-full max-w-md rounded-[2rem] border p-6 sm:p-8">
        <div className="mb-6 space-y-2">
          <span className="section-title text-xs text-slate-500">
            Password recovery
          </span>
          <h1 className="font-[family-name:var(--font-geist-mono)] text-3xl text-slate-950">
            Reset your password
          </h1>
          <p className="text-sm leading-7 text-slate-600">
            Enter your approved email address and we will send a reset link if
            the account exists.
          </p>
        </div>

        <ForgotPasswordForm />

        <Link className="mt-6 block text-sm font-semibold text-brand" href="/login">
          Return to login
        </Link>
      </div>
    </main>
  );
}
