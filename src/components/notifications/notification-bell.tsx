"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Target,
  GitBranch,
  RefreshCw,
  Send,
  ThumbsUp,
  Undo2,
  CheckCircle2,
  XCircle,
  Calendar,
  Pencil,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NotificationType =
  | "KPI_ALLOCATED"
  | "KPI_CASCADED"
  | "TARGET_UPDATED"
  | "ACHIEVEMENT_SUBMITTED"
  | "ACHIEVEMENT_RECOMMENDED"
  | "ACHIEVEMENT_SENT_BACK"
  | "ACHIEVEMENT_VERIFIED"
  | "ACHIEVEMENT_NOT_APPROVED"
  | "ACHIEVEMENT_APPROVED"
  | "ACHIEVEMENT_REJECTED"
  | "ACHIEVEMENT_WITHDRAWN"
  | "ACHIEVEMENT_RESUBMITTED"
  | "ACHIEVEMENT_CORRECTED"
  | "REWARD_DRAFT"
  | "REWARD_PENDING"
  | "REWARD_RELEASED"
  | "REWARD_REVOKED"
  | "PERIOD_STATE_CHANGED";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
};

const NOTIFICATION_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
  KPI_ALLOCATED: { icon: Target, color: "text-blue-500" },
  KPI_CASCADED: { icon: GitBranch, color: "text-blue-500" },
  TARGET_UPDATED: { icon: RefreshCw, color: "text-amber-500" },
  ACHIEVEMENT_SUBMITTED: { icon: Send, color: "text-blue-500" },
  ACHIEVEMENT_RECOMMENDED: { icon: ThumbsUp, color: "text-green-500" },
  ACHIEVEMENT_SENT_BACK: { icon: Undo2, color: "text-amber-500" },
  ACHIEVEMENT_VERIFIED: { icon: CheckCircle2, color: "text-green-500" },
  ACHIEVEMENT_NOT_APPROVED: { icon: XCircle, color: "text-red-500" },
  ACHIEVEMENT_APPROVED: { icon: CheckCircle2, color: "text-green-500" },
  ACHIEVEMENT_REJECTED: { icon: XCircle, color: "text-red-500" },
  ACHIEVEMENT_WITHDRAWN: { icon: Undo2, color: "text-amber-500" },
  ACHIEVEMENT_RESUBMITTED: { icon: RefreshCw, color: "text-blue-500" },
  ACHIEVEMENT_CORRECTED: { icon: Pencil, color: "text-amber-500" },
  REWARD_DRAFT: { icon: Wallet, color: "text-slate-500" },
  REWARD_PENDING: { icon: Wallet, color: "text-amber-500" },
  REWARD_RELEASED: { icon: Wallet, color: "text-green-500" },
  REWARD_REVOKED: { icon: Wallet, color: "text-red-500" },
  PERIOD_STATE_CHANGED: { icon: Calendar, color: "text-purple-500" },
};

function getRelativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function NotificationBell() {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch("/api/tenant/notifications/count");
      if (res.ok) {
        const data = (await res.json()) as { count: number };
        setUnreadCount(data.count);
      }
    } catch {
      // silently fail
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tenant/notifications?limit=20&offset=0");
      if (res.ok) {
        const data = (await res.json()) as {
          notifications: NotificationItem[];
          unreadCount: number;
        };
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + polling every 60 seconds
  useEffect(() => {
    void fetchCount();
    const interval = setInterval(() => {
      void fetchCount();
    }, 60_000);
    return () => clearInterval(interval);
  }, [fetchCount]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleOpen() {
    const next = !open;
    setOpen(next);
    if (next) {
      await fetchNotifications();
    }
  }

  async function handleClickNotification(notification: NotificationItem) {
    if (!notification.isRead) {
      try {
        await fetch("/api/tenant/notifications/mark-read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notificationId: notification.id }),
        });
        setNotifications((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n)),
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch {
        // silently fail
      }
    }
    if (notification.linkUrl) {
      router.push(notification.linkUrl);
      setOpen(false);
    }
  }

  async function handleMarkAllRead() {
    try {
      await fetch("/api/tenant/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
      // silently fail
    }
  }

  const badgeLabel = unreadCount > 99 ? "99+" : unreadCount > 0 ? String(unreadCount) : null;

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => { void handleOpen(); }}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white/60 text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {badgeLabel && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white leading-none">
            {badgeLabel}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="text-sm font-semibold text-slate-900">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={() => { void handleMarkAllRead(); }}
                className="text-xs font-medium text-blue-600 hover:text-blue-800 transition"
              >
                Mark all as read
              </button>
            )}
          </div>

          {/* Body */}
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="py-8 text-center text-sm text-slate-500">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">No notifications yet</div>
            ) : (
              <ul>
                {notifications.map((n) => {
                  const iconDef = NOTIFICATION_ICONS[n.type as NotificationType];
                  const Icon = iconDef?.icon ?? Bell;
                  const iconColor = iconDef?.color ?? "text-slate-400";
                  return (
                    <li key={n.id}>
                      <button
                        onClick={() => { void handleClickNotification(n); }}
                        className={cn(
                          "flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50",
                          !n.isRead && "bg-blue-50/50",
                        )}
                      >
                        <div
                          className={cn(
                            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                            !n.isRead ? "bg-white shadow-sm" : "bg-slate-100",
                          )}
                        >
                          <Icon className={cn("h-3.5 w-3.5", iconColor)} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p
                              className={cn(
                                "text-xs font-medium leading-tight",
                                n.isRead ? "text-slate-600" : "text-slate-900",
                              )}
                            >
                              {n.title}
                            </p>
                            {!n.isRead && (
                              <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-slate-400 leading-tight line-clamp-2">
                            {n.message}
                          </p>
                          <p className="mt-1 text-[10px] text-slate-300">
                            {getRelativeTime(n.createdAt)}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
