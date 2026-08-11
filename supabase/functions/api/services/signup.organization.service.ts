import type { OrgSignupInput } from "../schemas/schemas.ts";
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
  readonly p_sport_id: string;
};

export type RegisterOrganizationSuccess = {
  readonly ok: true;
  readonly userId: string;
  readonly orgId: string;
  readonly profileId: string;
  readonly teamIds: readonly string[];
};

export type RegisterOrganizationFailure = {
  readonly ok: false;
  readonly code: "email_taken" | "create_user_failed" | "rpc_failed";
  readonly message: string;
};

export type RegisterOrganizationResult = RegisterOrganizationSuccess | RegisterOrganizationFailure;

type RegisterOrgRpcRow = {
  readonly org_id: string;
  readonly profile_id: string;
  readonly team_ids: string[] | null;
};

const errorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
};

export const rpcRegisterOrg = (args: RegisterOrgRpcArgs) =>
  sbAdmin!.rpc("signup_register_org_tx", args);

export const registerOrganization = async (
  input: OrgSignupInput,
): Promise<RegisterOrganizationResult> => {
  const { admin, organization, sport_id, teams } = input;

  const { data: created, error: createErr } = await sbAdmin!.auth.admin.createUser({
    email: admin.email,
    password: admin.password,
    email_confirm: true,
    user_metadata: {
      first_name: admin.firstName,
      last_name: admin.lastName,
      role: "owner",
    },
    app_metadata: { role: "owner" },
  });

  if (createErr || !created?.user) {
    const message = errorMessage(createErr, "Could not create user");
    if (message.toLowerCase().includes("user already registered")) {
      return { ok: false, code: "email_taken", message: "Email already registered" };
    }
    return { ok: false, code: "create_user_failed", message };
  }

  const userId = created.user.id;
  const teamNames = teams.map((team) => team.name.trim()).filter(Boolean);

  const { data: rpcData, error: rpcErr } = await rpcRegisterOrg({
    p_user_id: userId,
    p_first_name: admin.firstName,
    p_last_name: admin.lastName,
    p_email: admin.email,
    p_phone: admin.phone ?? null,
    p_org_name: organization.name,
    p_program_gender: organization.programGender,
    p_team_names: teamNames,
    p_sport_id: sport_id,
  });

  const rows = rpcData as RegisterOrgRpcRow[] | null;
  if (rpcErr || !rows?.length) {
    await sbAdmin!.auth.admin.deleteUser(userId).catch(() => {});
    return {
      ok: false,
      code: "rpc_failed",
      message: errorMessage(rpcErr, "RPC returned no data"),
    };
  }

  const result = rows[0];
  return {
    ok: true,
    userId,
    orgId: result.org_id,
    profileId: result.profile_id,
    teamIds: result.team_ids ?? [],
  };
};
