import { prisma } from "@/lib/prisma";
import { markRead } from "@/lib/notifications/notification-service";
import {
  cleanupTrackedData,
  createTestMembership,
  createTestTenant,
  createTestUser,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";

async function withIsolatedDb(run: (tracker: DbTracker) => Promise<void>) {
  const tracker = newDbTracker();
  try {
    await run(tracker);
  } finally {
    await cleanupTrackedData(tracker);
  }
}

describe("notification service", () => {
  test("markRead only updates notifications within the caller's tenant", async () => {
    await withIsolatedDb(async (tracker) => {
      const user = await createTestUser(tracker, {
        firstName: "Nina",
        lastName: "Notifier",
      });
      const tenantOne = await createTestTenant(tracker, { code: `NT1_${Date.now()}` });
      const tenantTwo = await createTestTenant(tracker, { code: `NT2_${Date.now()}` });

      await createTestMembership({
        tenantId: tenantOne.id,
        userId: user.id,
        role: "TENANT_USER",
        createdByUserId: user.id,
      });
      await createTestMembership({
        tenantId: tenantTwo.id,
        userId: user.id,
        role: "TENANT_USER",
        createdByUserId: user.id,
      });

      const tenantOneNotification = await prisma.notification.create({
        data: {
          tenantId: tenantOne.id,
          userId: user.id,
          type: "TEST",
          title: "Tenant one",
          message: "Tenant one notification",
        },
      });
      const tenantTwoNotification = await prisma.notification.create({
        data: {
          tenantId: tenantTwo.id,
          userId: user.id,
          type: "TEST",
          title: "Tenant two",
          message: "Tenant two notification",
        },
      });

      await markRead(tenantTwoNotification.id, tenantOne.id, user.id);

      expect(
        await prisma.notification.findUnique({
          where: { id: tenantOneNotification.id },
          select: { isRead: true },
        }),
      ).toMatchObject({ isRead: false });
      expect(
        await prisma.notification.findUnique({
          where: { id: tenantTwoNotification.id },
          select: { isRead: true },
        }),
      ).toMatchObject({ isRead: false });

      await markRead(tenantOneNotification.id, tenantOne.id, user.id);

      expect(
        await prisma.notification.findUnique({
          where: { id: tenantOneNotification.id },
          select: { isRead: true },
        }),
      ).toMatchObject({ isRead: true });
      expect(
        await prisma.notification.findUnique({
          where: { id: tenantTwoNotification.id },
          select: { isRead: true },
        }),
      ).toMatchObject({ isRead: false });
    });
  });
});
