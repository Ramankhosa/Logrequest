import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/auth/session";
import { roleLandingPath } from "@/lib/auth/utils";

export default async function PostAuthPage() {
  const context = await requireTenantUser();
  redirect(roleLandingPath(context));
}
