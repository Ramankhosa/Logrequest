import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      firstName: string;
      lastName: string;
      isSuperadmin: boolean;
      role: Role | null;
      tenantId: string | null;
      tenantCode: string | null;
      tenantName: string | null;
    };
  }

  interface User {
    id: string;
    firstName: string;
    lastName: string;
    isSuperadmin: boolean;
    role: Role | null;
    tenantId: string | null;
    tenantCode: string | null;
    tenantName: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    firstName?: string;
    lastName?: string;
    isSuperadmin?: boolean;
    role?: Role | null;
    tenantId?: string | null;
    tenantCode?: string | null;
    tenantName?: string | null;
  }
}
