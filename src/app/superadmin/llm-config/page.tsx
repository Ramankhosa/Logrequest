import { AppShell } from "@/components/app-shell";
import { LlmConfigManager } from "@/components/llm/llm-config-manager";
import { getShellIdentity } from "@/lib/auth/access";
import { requireSuperadmin } from "@/lib/auth/session";
import { superadminNavigationGroups } from "@/lib/navigation";

export default async function SuperadminLlmConfigPage() {
  const context = await requireSuperadmin();

  return (
    <AppShell
      eyebrow="Superadmin"
      title="LLM Config"
      description="Manage platform-owned models, fallback profiles, and provider health for accreditation copilot."
      navigationGroups={superadminNavigationGroups}
      userSummary={getShellIdentity(context)}
    >
      <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/60 p-6">
        <LlmConfigManager />
      </section>
    </AppShell>
  );
}
