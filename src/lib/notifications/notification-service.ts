import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotificationView = {
  id: string;
  tenantId: string;
  userId: string;
  type: string;
  eventKey: string | null;
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
  const ids = await resolveUnitHeadUserIds(tenantId, unitId);
  return ids[0] ?? null;
}

/** All active unit-head user IDs for a unit (there may be more than one). */
export async function resolveUnitHeadUserIds(
  tenantId: string,
  unitId: string,
): Promise<string[]> {
  const version = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId,
      state: { in: ["PUBLISHED", "VALIDATED"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!version) return [];

  const headAssignments = await prisma.orgRoleAssignment.findMany({
    where: {
      versionId: version.id,
      unitId,
      isActive: true,
      roleDefinition: { isUnitHead: true },
    },
    select: { userId: true },
  });

  return [...new Set(headAssignments.map((h) => h.userId))];
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

export type CreateNotificationInput = {
  type: string;
  eventKey?: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  linkUrl?: string;
};

export async function createNotificationFromInput(
  tenantId: string,
  userId: string,
  data: CreateNotificationInput,
): Promise<void> {
  await createNotification(
    tenantId,
    userId,
    data.type,
    data.eventKey,
    data.title,
    data.message,
    data.entityType,
    data.entityId,
    data.linkUrl,
  );
}

export async function createNotification(
  tenantId: string,
  userId: string,
  type: string,
  eventKey: string | undefined,
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
        eventKey: eventKey ?? null,
        title,
        message,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        linkUrl: linkUrl ?? null,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      eventKey
    ) {
      return;
    }
    console.warn("[notification-service] Failed to create notification:", err);
  }
}

// ── Create Bulk Notifications ─────────────────────────────────────────────────

export async function createBulkNotifications(
  tenantId: string,
  userIds: string[],
  type: string,
  eventKey: string | undefined,
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
        eventKey: eventKey ? `${eventKey}:${userId}` : null,
        title,
        message,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        linkUrl: linkUrl ?? null,
      })),
      skipDuplicates: true,
    });
  } catch (err) {
    console.warn("[notification-service] Failed to create bulk notifications:", err);
  }
}

// ── List Notifications ────────────────────────────────────────────────────────

export type GetNotificationsOptions = {
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
};

export async function getNotifications(
  tenantId: string,
  userId: string,
  options?: GetNotificationsOptions,
): Promise<NotificationListResult> {
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;
  const baseWhere = {
    tenantId,
    userId,
    ...(options?.unreadOnly ? { isRead: false } : {}),
  };

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: baseWhere,
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
      eventKey: n.eventKey,
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

/** @deprecated Prefer getNotifications */
export async function listNotifications(
  tenantId: string,
  userId: string,
  limit = 20,
  offset = 0,
): Promise<NotificationListResult> {
  return getNotifications(tenantId, userId, { limit, offset });
}

// ── Mark Single Read ──────────────────────────────────────────────────────────

export async function markAsRead(
  notificationId: string,
  tenantId: string,
  userId: string,
): Promise<void> {
  await markRead(notificationId, tenantId, userId);
}

export async function markRead(
  notificationId: string,
  tenantId: string,
  userId: string,
): Promise<void> {
  await prisma.notification.updateMany({
    where: { id: notificationId, tenantId, userId },
    data: { isRead: true },
  });
}

// ── Mark All Read ─────────────────────────────────────────────────────────────

export async function markAllAsRead(tenantId: string, userId: string): Promise<void> {
  await markAllRead(tenantId, userId);
}

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
