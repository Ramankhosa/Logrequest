import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { authOptions } from "@/lib/auth/options";

type LoginPageProps = {
  searchParams: Promise<{
    callbackUrl?: string;
    error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getServerSession(authOptions);

  if (session?.user?.id) {
    redirect("/post-auth");
  }

  const params = await searchParams;

  return (
    <main className="surface-grid flex min-h-screen items-center justify-center px-4 py-8">
      <LoginForm
        callbackUrl={params.callbackUrl}
        error={params.error}
        googleEnabled={Boolean(
          process.env.AUTH_GOOGLE_CLIENT_ID && process.env.AUTH_GOOGLE_CLIENT_SECRET,
        )}
        microsoftEnabled={Boolean(
          process.env.AUTH_MICROSOFT_CLIENT_ID &&
            process.env.AUTH_MICROSOFT_CLIENT_SECRET &&
            process.env.AUTH_MICROSOFT_TENANT_ID,
        )}
      />
    </main>
  );
}
