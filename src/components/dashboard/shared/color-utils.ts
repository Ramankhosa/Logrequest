export type DashboardTone = "brand" | "blue" | "amber" | "rose" | "slate";

export const CHART_COLORS = [
  "var(--brand)",
  "var(--blue)",
  "var(--accent)",
  "var(--danger)",
  "var(--slate)",
  "var(--brand)",
] as const;

export function scoreToTone(score: number | null | undefined): DashboardTone {
  if (score == null || Number.isNaN(score)) return "slate";
  if (score >= 80) return "brand";
  if (score >= 50) return "blue";
  if (score >= 25) return "amber";
  return "rose";
}

export function formatStateLabel(value: string | null | undefined) {
  if (!value) return "Unknown";

  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

const STATE_MAP: Record<string, { tone: DashboardTone; label: string }> = {
  DRAFT: { tone: "amber", label: "Draft" },
  SUBMITTED: { tone: "blue", label: "Submitted" },
  RECOMMENDED: { tone: "blue", label: "Recommended" },
  VERIFIED: { tone: "brand", label: "Verified" },
  REJECTED: { tone: "rose", label: "Rejected" },
  PENDING: { tone: "amber", label: "Pending" },
  RELEASED: { tone: "brand", label: "Released" },
  REVOKED: { tone: "rose", label: "Revoked" },
  IN_PROGRESS: { tone: "blue", label: "In Progress" },
  COMPLETED: { tone: "brand", label: "Completed" },
  OPEN: { tone: "blue", label: "Open" },
  UNDER_REVIEW: { tone: "amber", label: "Under Review" },
  CLOSED: { tone: "slate", label: "Closed" },
  ARCHIVED: { tone: "slate", label: "Archived" },
  ACTIVE: { tone: "brand", label: "Active" },
  PAID: { tone: "brand", label: "Paid" },
  READY: { tone: "brand", label: "Ready" },
  ACCEPTED: { tone: "brand", label: "Accepted" },
  ENABLED: { tone: "brand", label: "Enabled" },
  SUSPENDED: { tone: "rose", label: "Suspended" },
  RISK: { tone: "rose", label: "Risk" },
  EXPIRED: { tone: "rose", label: "Expired" },
  SEPARATED: { tone: "rose", label: "Separated" },
  WARNING: { tone: "amber", label: "Warning" },
  GRACE: { tone: "amber", label: "Grace" },
  REVIEW_REQUIRED: { tone: "amber", label: "Review Required" },
  ON_LEAVE: { tone: "amber", label: "On Leave" },
  ONBOARDING: { tone: "amber", label: "Onboarding" },
  NOTICE_PERIOD: { tone: "amber", label: "Notice Period" },
};

export function stateToTone(state: string | null | undefined): DashboardTone {
  const normalized = normalizeKey(state);
  return STATE_MAP[normalized]?.tone ?? inferGenericTone(normalized);
}

export function stateToLabel(state: string | null | undefined) {
  const normalized = normalizeKey(state);
  return STATE_MAP[normalized]?.label ?? formatStateLabel(state);
}

export function toneToMetricClasses(tone: DashboardTone) {
  switch (tone) {
    case "brand":
      return {
        icon: "border-brand/15 bg-brand-soft/80 text-brand",
        border: "border-l-brand",
        dot: "bg-brand",
        soft: "bg-brand-soft/60",
      };
    case "blue":
      return {
        icon: "border-blue/15 bg-blue-soft/85 text-blue",
        border: "border-l-blue",
        dot: "bg-blue",
        soft: "bg-blue-soft/70",
      };
    case "amber":
      return {
        icon: "border-accent/15 bg-amber-50 text-amber-700",
        border: "border-l-accent",
        dot: "bg-accent",
        soft: "bg-amber-50",
      };
    case "rose":
      return {
        icon: "border-danger/15 bg-rose-50 text-danger",
        border: "border-l-danger",
        dot: "bg-danger",
        soft: "bg-rose-50",
      };
    case "slate":
    default:
      return {
        icon: "border-slate-200 bg-slate-100 text-slate-600",
        border: "border-l-slate-400",
        dot: "bg-slate-500",
        soft: "bg-slate-100",
      };
  }
}

export function toneToPillClasses(tone: DashboardTone) {
  switch (tone) {
    case "brand":
      return "border-brand/15 bg-brand-soft text-brand";
    case "blue":
      return "border-blue/15 bg-blue-soft text-blue";
    case "amber":
      return "border-accent/15 bg-amber-50 text-amber-700";
    case "rose":
      return "border-danger/15 bg-rose-50 text-danger";
    case "slate":
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

export function toneToFillClass(tone: DashboardTone) {
  switch (tone) {
    case "brand":
      return "bg-brand";
    case "blue":
      return "bg-blue";
    case "amber":
      return "bg-accent";
    case "rose":
      return "bg-danger";
    case "slate":
    default:
      return "bg-slate-500";
  }
}

export function toneToTextClass(tone: DashboardTone) {
  switch (tone) {
    case "brand":
      return "text-brand";
    case "blue":
      return "text-blue";
    case "amber":
      return "text-amber-700";
    case "rose":
      return "text-danger";
    case "slate":
    default:
      return "text-slate-600";
  }
}

export function toneToCssValue(tone: DashboardTone) {
  switch (tone) {
    case "brand":
      return "var(--brand)";
    case "blue":
      return "var(--blue)";
    case "amber":
      return "var(--accent)";
    case "rose":
      return "var(--danger)";
    case "slate":
    default:
      return "var(--slate)";
  }
}

function normalizeKey(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase().replaceAll(" ", "_");
}

function inferGenericTone(normalized: string): DashboardTone {
  if (
    normalized.includes("ACTIVE") ||
    normalized.includes("PAID") ||
    normalized.includes("READY") ||
    normalized.includes("ACCEPTED") ||
    normalized.includes("ENABLED")
  ) {
    return "brand";
  }

  if (
    normalized.includes("SUSPENDED") ||
    normalized.includes("REVOKED") ||
    normalized.includes("REJECTED") ||
    normalized.includes("RISK") ||
    normalized.includes("EXPIRED") ||
    normalized.includes("SEPARATED")
  ) {
    return "rose";
  }

  if (
    normalized.includes("PENDING") ||
    normalized.includes("GRACE") ||
    normalized.includes("WARNING") ||
    normalized.includes("REVIEW") ||
    normalized.includes("DEFERRED") ||
    normalized.includes("ON_LEAVE") ||
    normalized.includes("ONBOARDING") ||
    normalized.includes("NOTICE_PERIOD") ||
    normalized.includes("DRAFT")
  ) {
    return "amber";
  }

  return "slate";
}
