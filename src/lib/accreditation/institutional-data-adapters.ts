import {
  AchievementState,
  DataBankCoverageStatus,
  DataBankSnapshotEntryMode,
  DataBankValueMaturity,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

type AdapterDatasetRow = {
  rowIndex?: number;
  rowKey?: string | null;
  rowData: Prisma.JsonObject;
  sourceRef?: string | null;
};

export type InstitutionalDataAdapterSnapshot = {
  observedYear: number | null;
  scopeKey?: string | null;
  numberValue?: number | null;
  textValue?: string | null;
  jsonValue?: Prisma.JsonObject | null;
  maturity?: DataBankValueMaturity;
  coverageStatus?: DataBankCoverageStatus;
  coveragePercent?: number | null;
  confidenceNote?: string | null;
  sourceRef?: string | null;
  entryMode?: DataBankSnapshotEntryMode;
  evidenceMeta?: Prisma.JsonValue;
  datasetRows?: AdapterDatasetRow[];
  replaceRows?: boolean;
};

export type InstitutionalDataAdapterResult = {
  snapshots: InstitutionalDataAdapterSnapshot[];
};

export type InstitutionalDataAdapterContext = {
  tenantId: string;
  source: {
    id: string;
    code: string;
    name: string;
    adapterKey: string;
    adapterConfig: Prisma.JsonValue | null;
  };
};

export type InstitutionalDataAdapter = {
  key: string;
  label: string;
  refresh(context: InstitutionalDataAdapterContext): Promise<InstitutionalDataAdapterResult>;
};

function isoOrNull(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function asJsonObject(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Prisma.JsonObject;
}

function flattenPrimitiveObject(value: Prisma.JsonObject | null) {
  if (!value) {
    return {};
  }
  const output: Prisma.JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      output[`form_${key}`] = item;
    }
  }
  return output;
}

const personnelMembershipRosterAdapter: InstitutionalDataAdapter = {
  key: "personnel.membership_roster",
  label: "Personnel Membership Roster",
  async refresh(context) {
    const memberships = await prisma.membership.findMany({
      where: {
        tenantId: context.tenantId,
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            officialEmail: true,
          },
        },
      },
      orderBy: [{ department: "asc" }, { designation: "asc" }, { createdAt: "asc" }],
    });

    return {
      snapshots: [
        {
          observedYear: null,
          scopeKey: "DEFAULT",
          jsonValue: { adapter: context.source.adapterKey },
          maturity: DataBankValueMaturity.REPORTED,
          coverageStatus: DataBankCoverageStatus.COMPLETE,
          coveragePercent: 100,
          confidenceNote: "Current-state membership roster from Personnel module.",
          sourceRef: `${context.source.adapterKey}:current`,
          entryMode: DataBankSnapshotEntryMode.ADAPTER_REFRESH,
          replaceRows: true,
          datasetRows: memberships.map((membership, index) => ({
            rowIndex: index,
            rowKey: membership.employeeId ?? membership.id,
            sourceRef: membership.id,
            rowData: {
              membershipId: membership.id,
              userId: membership.userId,
              employeeId: membership.employeeId ?? null,
              firstName: membership.user.firstName ?? null,
              lastName: membership.user.lastName ?? null,
              fullName: [membership.user.firstName, membership.user.lastName].filter(Boolean).join(" ") || null,
              officialEmail: membership.user.officialEmail ?? null,
              role: membership.role,
              department: membership.department ?? null,
              designation: membership.designation ?? null,
              status: membership.status,
              personnelStatus: membership.personnelStatus,
              invitationState: membership.invitationState,
              dateOfJoining: isoOrNull(membership.dateOfJoining),
              activationTimestamp: isoOrNull(membership.activationTimestamp),
              lastAccessTimestamp: isoOrNull(membership.lastAccessTimestamp),
              createdAt: membership.createdAt.toISOString(),
              updatedAt: membership.updatedAt.toISOString(),
            },
          })),
        },
      ],
    };
  },
};

const verifiedAchievementsRegistryAdapter: InstitutionalDataAdapter = {
  key: "achievements.verified_registry",
  label: "Verified Achievements Registry",
  async refresh(context) {
    const achievements = await prisma.achievement.findMany({
      where: {
        tenantId: context.tenantId,
        state: AchievementState.VERIFIED,
      },
      include: {
        kpiDefinition: {
          select: {
            title: true,
            achievementTemplateKey: true,
          },
        },
      },
      orderBy: [{ reportingDate: "asc" }, { createdAt: "asc" }],
    });

    const rowsByYear = new Map<number, AdapterDatasetRow[]>();
    for (const achievement of achievements) {
      const year = achievement.reportingDate.getUTCFullYear();
      const formData = asJsonObject(achievement.achievementFormData);
      const rows = rowsByYear.get(year) ?? [];
      rows.push({
        rowIndex: rows.length,
        rowKey: achievement.id,
        sourceRef: achievement.id,
        rowData: {
          achievementId: achievement.id,
          periodId: achievement.periodId,
          kpiDefinitionId: achievement.kpiDefinitionId,
          kpiTitle: achievement.kpiDefinition.title,
          templateKey: achievement.kpiDefinition.achievementTemplateKey ?? null,
          reportedByUserId: achievement.reportedByUserId,
          oboReportedForUserId: achievement.oboReportedForUserId ?? null,
          state: achievement.state,
          actualValue: achievement.actualValue ?? null,
          computedScore: achievement.computedScore ?? null,
          effectiveScore: achievement.effectiveScore ?? null,
          stageCompletionScore: achievement.stageCompletionScore ?? null,
          contributionRole: achievement.contributionRole ?? null,
          reportingDate: achievement.reportingDate.toISOString(),
          recommendedAt: isoOrNull(achievement.recommendedAt),
          verifiedAt: isoOrNull(achievement.verifiedAt),
          actualDate: isoOrNull(achievement.actualDate),
          title: achievement.title ?? null,
          ...flattenPrimitiveObject(formData),
          achievementFormData: formData ?? null,
        },
      });
      rowsByYear.set(year, rows);
    }

    return {
      snapshots: [...rowsByYear.entries()]
        .sort(([left], [right]) => left - right)
        .map(([year, datasetRows]) => ({
          observedYear: year,
          scopeKey: `YEAR:${year}`,
          jsonValue: { adapter: context.source.adapterKey, year },
          maturity: DataBankValueMaturity.VERIFIED,
          coverageStatus: DataBankCoverageStatus.COMPLETE,
          coveragePercent: 100,
          confidenceNote: `Verified achievements for ${year}.`,
          sourceRef: `${context.source.adapterKey}:${year}`,
          entryMode: DataBankSnapshotEntryMode.ADAPTER_REFRESH,
          replaceRows: true,
          datasetRows,
        })),
    };
  },
};

const adapters = [
  personnelMembershipRosterAdapter,
  verifiedAchievementsRegistryAdapter,
] as const;

const adapterMap = new Map(adapters.map((adapter) => [adapter.key, adapter] satisfies [string, InstitutionalDataAdapter]));

export function getInstitutionalDataAdapter(adapterKey: string | null | undefined) {
  if (!adapterKey) {
    return null;
  }
  return adapterMap.get(adapterKey) ?? null;
}

export function listInstitutionalDataAdapters() {
  return adapters.map((adapter) => ({
    key: adapter.key,
    label: adapter.label,
  }));
}
