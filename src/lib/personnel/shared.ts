export type PersonnelActionResult = {
  status: "idle" | "success" | "error";
  message: string;
};

export const initialPersonnelActionResult: PersonnelActionResult = {
  status: "idle",
  message: "",
};

export type PlacementSummaryUnit = {
  assignmentId: string;
  unitId: string;
  unitCode: string;
  unitName: string;
  unitLevel: number;
  unitPath: string | null;
  assignmentType: "PRIMARY" | "SECONDARY";
  isPrimary: boolean;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  roles: PlacementSummaryRole[];
};

export type PlacementSummaryRole = {
  assignmentId: string;
  roleDefinitionId: string | null;
  roleKey: string;
  roleName: string;
  isUnitHead: boolean;
  scope: string;
  isActive: boolean;
};

export type PlacementSummary = {
  membershipId: string;
  userId: string;
  userName: string;
  userEmail: string;
  employeeId: string | null;
  designation: string | null;
  personnelStatus: string;
  membershipStatus: string;
  dateOfJoining: Date | null;
  units: PlacementSummaryUnit[];
};

export type OnboardingOptions = {
  units: Array<{
    id: string;
    code: string;
    name: string;
    level: number;
    path: string | null;
    state: string;
    typeName: string;
  }>;
  roles: Array<{
    id: string;
    roleKey: string;
    displayLabel: string;
    isUnitHead: boolean;
    maxPerUnit: number;
  }>;
};

export type TransferKpiPolicy = "CARRY_ALL" | "LEAVE_ALL" | "SELECTIVE";
export type TransferKpiTargetAction = "CARRY" | "LEAVE";
export type TransferTargetActionType =
  | "CARRIED"
  | "LEFT_BEHIND"
  | "LOCKED_SOURCE_ONLY"
  | "REASSIGNED_AFTER_TRANSFER";
export type TransferStatusEventType =
  | "INITIATED"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "EXECUTED"
  | "CONFIGURED";

export type TransferKpiDetail = {
  targetAllocationId: string;
  action: TransferKpiTargetAction;
};

export type TransferStatusEventView = {
  id: string;
  eventType: TransferStatusEventType;
  actorUserId: string | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

export type TransferTargetActionView = {
  id: string;
  targetAllocationId: string;
  targetTitle: string;
  periodName: string;
  action: TransferTargetActionType;
  previousUnitId: string | null;
  previousUnitName: string | null;
  newUnitId: string | null;
  newUnitName: string | null;
  notes: string | null;
  createdAt: Date;
};

export type TransferView = {
  id: string;
  tenantId: string;
  membershipId: string;
  userId: string;
  userName: string;
  userEmail: string;
  sourceUnitId: string;
  sourceUnitName: string;
  sourceUnitCode: string;
  targetUnitId: string;
  targetUnitName: string;
  targetUnitCode: string;
  effectiveDate: Date;
  status: "PROPOSED" | "APPROVED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "REJECTED";
  reason: string | null;
  completionNotes: string | null;
  newRoleDefinitionIds: string[];
  kpiTransferPolicy: TransferKpiPolicy | null;
  kpiTransferDetails: TransferKpiDetail[];
  initiatedByUserId: string | null;
  approvedByUserId: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  targetActions: TransferTargetActionView[];
  statusEvents: TransferStatusEventView[];
};

export type TransferableTarget = {
  targetAllocationId: string;
  kpiDefinitionId: string;
  kpiTitle: string;
  periodId: string;
  periodName: string;
  state: "ACTIVE" | "LOCKED";
  targetDisplay: string;
  achievementCount: number;
  submittedCount: number;
  recommendedCount: number;
  verifiedCount: number;
  isLocked: boolean;
  defaultAction: TransferKpiTargetAction | null;
};

export type TransferFilters = {
  status?: "PROPOSED" | "APPROVED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "REJECTED";
  sourceUnitId?: string;
  targetUnitId?: string;
  membershipId?: string;
};

export type TransferMemberOption = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  employeeId: string | null;
  designation: string | null;
  personnelStatus: string;
  membershipStatus: string;
  sourceUnitId: string;
  sourceUnitCode: string;
  sourceUnitName: string;
};

export type TransferSetupOptions = {
  units: OnboardingOptions["units"];
  roles: OnboardingOptions["roles"];
  members: TransferMemberOption[];
};
