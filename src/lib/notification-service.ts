/**
 * Tenant notification API (R2.2). Implementation lives in ./notifications/.
 */
export {
  createNotification,
  createNotificationFromInput,
  createBulkNotifications,
  getNotifications,
  listNotifications,
  markAsRead,
  markRead,
  markAllAsRead,
  markAllRead,
  getUnreadCount,
  resolveUnitHead,
  resolveUnitHeadUserIds,
  resolveAllocateeUserId,
} from "./notifications/notification-service";

export type {
  NotificationView,
  NotificationListResult,
  CreateNotificationInput,
  GetNotificationsOptions,
} from "./notifications/notification-service";
