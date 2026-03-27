"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Info, X } from "lucide-react";

export type OrientationBannerProps = {
  storageKey: string;
  message: string;
  learnMoreUrl?: string;
};

export function OrientationBanner({
  storageKey,
  message,
  learnMoreUrl,
}: OrientationBannerProps) {
  const dismissed = useSyncExternalStore(
    subscribeToStorage,
    () => readDismissed(storageKey),
    () => true,
  );

  if (dismissed) return null;

  return (
    <div className="flex items-start gap-3 rounded-[1.5rem] border border-blue/15 bg-blue-soft/85 px-4 py-3 text-blue">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70">
        <Info className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-6">{message}</p>
        {learnMoreUrl ? (
          <Link
            href={learnMoreUrl}
            className="mt-1 inline-flex text-xs font-semibold underline underline-offset-4"
          >
            Learn more
          </Link>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss dashboard orientation banner"
        onClick={() => {
          try {
            window.localStorage.setItem(storageKey, "dismissed");
            window.dispatchEvent(new Event("dashboard-orientation-change"));
          } catch {
            // ignore storage failures
          }
        }}
        className="rounded-full p-1 text-blue/80 transition hover:bg-white/60 hover:text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/20"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function subscribeToStorage(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const listener = () => onStoreChange();
  window.addEventListener("storage", listener);
  window.addEventListener("dashboard-orientation-change", listener);

  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("dashboard-orientation-change", listener);
  };
}

function readDismissed(storageKey: string) {
  if (typeof window === "undefined") return true;

  try {
    return window.localStorage.getItem(storageKey) === "dismissed";
  } catch {
    return false;
  }
}
