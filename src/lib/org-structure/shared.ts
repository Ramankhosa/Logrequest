export type OrgStructureActionResult = {
  status: "idle" | "success" | "error";
  message: string;
};

export const initialOrgStructureActionResult: OrgStructureActionResult = {
  status: "idle",
  message: "",
};
