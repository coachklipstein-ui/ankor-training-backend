import { sbAdmin } from "./supabase.ts";

export type RegisterOrgRpcArgs = {
  readonly p_user_id: string;
  readonly p_first_name: string;
  readonly p_last_name: string;
  readonly p_email: string;
  readonly p_phone: string | null;
  readonly p_org_name: string;
  readonly p_program_gender: "girls" | "boys" | "coed";
  readonly p_team_names: readonly string[];
  readonly p_sport_id: string | null;
};

export const rpcRegisterOrg = (args: RegisterOrgRpcArgs) =>
  sbAdmin!.rpc("signup_register_org_tx", args);
