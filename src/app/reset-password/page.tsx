import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

type ResetPasswordPageProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;

  return (
    <main className="surface-grid flex min-h-screen items-center justify-center px-4 py-8">
      <div className="glass-panel w-full max-w-md rounded-[2rem] border p-6 sm:p-8">
        <div className="mb-6 space-y-2">
          <span className="section-title text-xs text-slate-500">
            Password recovery
          </span>
          <h1 className="font-[family-name:var(--font-geist-mono)] text-3xl text-slate-950">
            Set a new password
          </h1>
          <p className="text-sm leading-7 text-slate-600">
            Use a strong password that meets the platform rules.
          </p>
        </div>

        {params.token ? (
          <ResetPasswordForm token={params.token} />
        ) : (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Reset token is missing.
          </div>
        )}

        <Link className="mt-6 block text-sm font-semibold text-brand" href="/login">
          Return to login
        </Link>
      </div>
    </main>
  );
}
