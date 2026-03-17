import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserLifecycleState } from "@prisma/client";
import { hash } from "bcryptjs";
import pg from "pg";

const { Pool } = pg;
const DATABASE_URL = "postgresql://postgres:123@localhost:5432/logrequest";
const pool = new Pool({
  connectionString: DATABASE_URL,
});

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});

const email = (process.env.SUPERADMIN_EMAIL ?? "superadmin@local.test").trim().toLowerCase();
const password = process.env.SUPERADMIN_PASSWORD ?? "Admin@12345";
const firstName = process.env.SUPERADMIN_FIRST_NAME ?? "Platform";
const lastName = process.env.SUPERADMIN_LAST_NAME ?? "Admin";

async function main() {
  const passwordHash = await hash(password, 12);

  const user = await prisma.user.upsert({
    where: {
      officialEmail: email,
    },
    update: {
      firstName,
      lastName,
      isSuperadmin: true,
      lifecycleState: UserLifecycleState.ACTIVE,
      passwordHash,
      passwordSetAt: new Date(),
      passwordChangedAt: new Date(),
      emailVerifiedAt: new Date(),
      allowedLoginMethods: ["PASSWORD", "GOOGLE", "MICROSOFT"],
      mustResetPassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
    },
    create: {
      firstName,
      lastName,
      officialEmail: email,
      isSuperadmin: true,
      lifecycleState: UserLifecycleState.ACTIVE,
      passwordHash,
      passwordSetAt: new Date(),
      passwordChangedAt: new Date(),
      emailVerifiedAt: new Date(),
      allowedLoginMethods: ["PASSWORD", "GOOGLE", "MICROSOFT"],
      mustResetPassword: false,
    },
  });

  console.log("Superadmin ready:", {
    email: user.officialEmail,
    userId: user.id,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
