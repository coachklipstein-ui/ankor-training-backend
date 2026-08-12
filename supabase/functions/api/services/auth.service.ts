import { sbAdmin } from "./supabase.ts";
import { getOrgRole, type OrgRole } from "../utils/roles.ts";

export type LoginUserDto = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  org_role: OrgRole | null;
  default_org_id: string | null;
  coach_id: string | null;
  athlete_id: string | null;
};

export type ResolveLoginUserResult =
  | { ok: true; data: LoginUserDto }
  | { ok: false; code: "not_configured" | "not_found" | "load_failed"; message: string };

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  default_org_id: string | null;
};

const resolveEffectiveProfileRole = async (
  profile: ProfileRow,
): Promise<{ role: string | null; error: unknown }> => {
  const profileUserId = typeof profile.id === "string" ? profile.id.trim() : "";
  const profileOrgId = typeof profile.default_org_id === "string" ? profile.default_org_id.trim() : "";
  let effectiveRole = profile.role ?? null;

  if (!profileOrgId || !profileUserId || effectiveRole === "parent") {
    return { role: effectiveRole, error: null };
  }

  const client = sbAdmin;
  if (!client) {
    return { role: null, error: new Error("Supabase admin client not configured") };
  }

  const { data: athleteRow, error: athleteErr } = await client
    .from("athletes")
    .select("email")
    .eq("org_id", profileOrgId)
    .eq("user_id", profileUserId)
    .maybeSingle();

  if (athleteErr) {
    return { role: null, error: athleteErr };
  }

  const { data: guardianRow, error: guardianErr } = await client
    .from("guardian_contacts")
    .select("email")
    .eq("org_id", profileOrgId)
    .eq("user_id", profileUserId)
    .maybeSingle();

  if (guardianErr) {
    return { role: null, error: guardianErr };
  }

  const athleteEmail = athleteRow?.email?.trim().toLowerCase() ?? "";
  const guardianEmail = guardianRow?.email?.trim().toLowerCase() ?? "";
  if (athleteEmail && guardianEmail && athleteEmail === guardianEmail) {
    effectiveRole = "parent";
  }

  return { role: effectiveRole, error: null };
};

const resolveEntityIds = async (
  effectiveRole: string | null,
  profileUserId: string,
  profileOrgId: string,
): Promise<{ coach_id: string | null; athlete_id: string | null; error: unknown }> => {
  const client = sbAdmin;
  if (!client) {
    return { coach_id: null, athlete_id: null, error: new Error("Supabase admin client not configured") };
  }

  if (!profileUserId || !profileOrgId) {
    return { coach_id: null, athlete_id: null, error: null };
  }

  if (effectiveRole === "coach") {
    const { data: coachRow, error: coachErr } = await client
      .from("coaches")
      .select("id")
      .eq("user_id", profileUserId)
      .eq("org_id", profileOrgId)
      .maybeSingle();

    if (coachErr) {
      return { coach_id: null, athlete_id: null, error: coachErr };
    }

    return { coach_id: coachRow?.id ?? null, athlete_id: null, error: null };
  }

  if (effectiveRole === "athlete") {
    const { data: athleteRow, error: athleteErr } = await client
      .from("athletes")
      .select("id")
      .eq("user_id", profileUserId)
      .eq("org_id", profileOrgId)
      .maybeSingle();

    if (athleteErr) {
      return { coach_id: null, athlete_id: null, error: athleteErr };
    }

    return { coach_id: null, athlete_id: athleteRow?.id ?? null, error: null };
  }

  return { coach_id: null, athlete_id: null, error: null };
};

const errorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
};

/**
 * Build the login/profile payload for a verified user id.
 * `role` is the profile-facing role (with parent email-match override).
 * `org_role` is resolved strictly via org membership / elevating profile roles (no parent override).
 */
export const resolveLoginUser = async (userId: string): Promise<ResolveLoginUserResult> => {
  const client = sbAdmin;
  if (!client) {
    return { ok: false, code: "not_configured", message: "Database client not configured" };
  }

  const { data: profile, error: profileErr } = await client
    .from("profiles")
    .select("id, email, full_name, role, default_org_id")
    .eq("id", userId)
    .maybeSingle();

  if (profileErr) {
    return {
      ok: false,
      code: "load_failed",
      message: `Failed to load profile: ${errorMessage(profileErr, "unknown error")}`,
    };
  }
  if (!profile) {
    return { ok: false, code: "not_found", message: "Profile not found" };
  }

  const profileRow: ProfileRow = {
    id: typeof profile.id === "string" ? profile.id : "",
    email: typeof profile.email === "string" ? profile.email : null,
    full_name: typeof profile.full_name === "string" ? profile.full_name : null,
    role: typeof profile.role === "string" ? profile.role : null,
    default_org_id: typeof profile.default_org_id === "string" ? profile.default_org_id : null,
  };

  const { role: effectiveRole, error: roleError } = await resolveEffectiveProfileRole(profileRow);
  if (roleError) {
    return {
      ok: false,
      code: "load_failed",
      message: `Failed to resolve profile role: ${errorMessage(roleError, "unknown error")}`,
    };
  }

  const profileUserId = profileRow.id.trim();
  const profileOrgId = profileRow.default_org_id?.trim() ?? "";
  const { coach_id, athlete_id, error: entityError } = await resolveEntityIds(
    effectiveRole,
    profileUserId,
    profileOrgId,
  );
  if (entityError) {
    return {
      ok: false,
      code: "load_failed",
      message: `Failed to load role entity: ${errorMessage(entityError, "unknown error")}`,
    };
  }

  let orgRole: OrgRole | null = null;
  if (profileOrgId && profileUserId) {
    const { role, error: orgRoleError } = await getOrgRole(profileUserId, profileOrgId, {
      role: profileRow.role,
      default_org_id: profileRow.default_org_id,
    });

    if (orgRoleError) {
      return {
        ok: false,
        code: "load_failed",
        message: `Failed to resolve organization role: ${errorMessage(orgRoleError, "unknown error")}`,
      };
    }

    orgRole = role;
  }

  return {
    ok: true,
    data: {
      id: profileRow.id,
      full_name: profileRow.full_name,
      email: profileRow.email,
      role: effectiveRole,
      org_role: orgRole,
      default_org_id: profileRow.default_org_id,
      coach_id,
      athlete_id,
    },
  };
};
