export type MemberCreationResult = {
  status: "idle" | "success" | "error";
  message: string;
};

export const initialMemberCreationResult: MemberCreationResult = {
  status: "idle",
  message: "",
};
