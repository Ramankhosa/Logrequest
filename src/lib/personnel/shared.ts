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
