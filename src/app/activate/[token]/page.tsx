import Link from "next/link";
import { ActivationForm } from "@/components/auth/activation-form";

type ActivationPageProps = {
  params: Promise<{
    token: string;
  }>;
};

export default async function ActivationPage({ params }: ActivationPageProps) {
  const { token } = await params;

  return (
    <main className="surface-grid flex min-h-screen items-center justify-center px-4 py-8">
      <div className="glass-panel w-full max-w-md rounded-[2rem] border p-6 sm:p-8">
        <div className="mb-6 space-y-2">
          <span className="section-title text-xs text-slate-500">
            Invitation activation
          </span>
          <h1 className="font-[family-name:var(--font-geist-mono)] text-3xl text-slate-950">
            Activate your account
          </h1>
          <p className="text-sm leading-7 text-slate-600">
            Set your password to complete first-time access for the organization.
          </p>
        </div>

        <ActivationForm token={token} />

        <Link className="mt-6 block text-sm font-semibold text-brand" href="/login">
          Return to login
        </Link>
      </div>
    </main>
  );
}
