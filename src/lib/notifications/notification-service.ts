import { prisma } from "@/lib/prisma";

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotificationView = {
  id: string;
  tenantId: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: Date;
};

export type NotificationListResult = {
  notifications: NotificationView[];
  total: number;
  unreadCount: number;
};

// ── Recipient Resolution Helpers ──────────────────────────────────────────────

/**
 * Finds the unit head userId for a given unit.
 * Returns null if unit has no head assigned.
 */
export async function resolveUnitHead(
  tenantId: string,
  unitId: string,
): Promise<string | null> {
  // Find the most recent published/validated org structure version
  const version = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId,
      state: { in: ["PUBLISHED", "VALIDATED"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!version) return null;

  const headAssignment = await prisma.orgRoleAssignment.findFirst({
    where: {
      versionId: version.id,
      unitId,
      isActive: true,
      roleDefinition: { isUnitHead: true },
    },
    select: { userId: true },
  });

  return headAssignment?.userId ?? null;
}

/**
 * Resolves the notification recipient userId from a target allocation.
 * If assigned to user directly, returns that userId.
 * If assigned to unit, returns the unit head userId.
 */
export async function resolveAllocateeUserId(
  tenantId: string,
  allocation: {
    assignedToUserId: string | null;
    assignedToUnitId: string | null;
  },
): Promise<string | null> {
  if (allocation.assignedToUserId) {
    return allocation.assignedToUserId;
  }
  if (allocation.assignedToUnitId) {
    return resolveUnitHead(tenantId, allocation.assignedToUnitId);
  }
  return null;
}

// ── Create Notification ───────────────────────────────────────────────────────

export async function createNotification(
  tenantId: string,
  userId: string,
  type: string,
  title: string,
  message: string,
  entityType?: string,
  entityId?: string,
  linkUrl?: string,
): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        tenantId,
        userId,
        type,
        title,
        message,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        linkUrl: linkUrl ?? null,
      },
    });
  } catch (err) {
    // Non-fatal — log warning, don't crash the main operation
    console.warn("[notification-service] Failed to create notification:", err);
  }
}

// ── Create Bulk Notifications ─────────────────────────────────────────────────

export async function createBulkNotifications(
  tenantId: string,
  userIds: string[],
  type: string,
  title: string,
  message: string,
  entityType?: string,
  entityId?: string,
  linkUrl?: string,
): Promise<void> {
  if (userIds.length === 0) return;

  try {
    await prisma.notification.createMany({
      data: userIds.map((userId) => ({
        tenantId,
        userId,
        type,
        title,
        message,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        linkUrl: linkUrl ?? null,
      })),
    });
  } catch (err) {
    console.warn("[notification-service] Failed to create bulk notifications:", err);
  }
}

// ── List Notifications ────────────────────────────────────────────────────────

export async function listNotifications(
  tenantId: string,
  userId: string,
  limit = 20,
  offset = 0,
): Promise<NotificationListResult> {
  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.notification.count({ where: { tenantId, userId } }),
    prisma.notification.count({ where: { tenantId, userId, isRead: false } }),
  ]);

  return {
    notifications: notifications.map((n) => ({
      id: n.id,
      tenantId: n.tenantId,
      userId: n.userId,
      type: n.type,
      title: n.title,
      message: n.message,
      entityType: n.entityType,
      entityId: n.entityId,
      linkUrl: n.linkUrl,
      isRead: n.isRead,
      createdAt: n.createdAt,
    })),
    total,
    unreadCount,
  };
}

// ── Mark Single Read ──────────────────────────────────────────────────────────

export async function markRead(
  notificationId: string,
  userId: string,
): Promise<void> {
  await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { isRead: true },
  });
}

// ── Mark All Read ─────────────────────────────────────────────────────────────

export async function markAllRead(
  tenantId: string,
  userId: string,
): Promise<void> {
  await prisma.notification.updateMany({
    where: { tenantId, userId, isRead: false },
    data: { isRead: true },
  });
}

// ── Get Unread Count ──────────────────────────────────────────────────────────

export async function getUnreadCount(
  tenantId: string,
  userId: string,
): Promise<number> {
  return prisma.notification.count({
    where: { tenantId, userId, isRead: false },
  });
}
