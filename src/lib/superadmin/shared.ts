export type TenantCreationResult = {
  status: "idle" | "success" | "error";
  message: string;
  tenantId?: string;
  tenantCode?: string;
  ownerEmail?: string;
  ownerCanSignIn?: boolean;
};

export const initialTenantCreationResult: TenantCreationResult = {
  status: "idle",
  message: "",
};
