import { sbAdmin } from "../services/supabase.ts";

export const ORG_ROLES = ["owner", "admin", "coach", "staff", "athlete", "parent", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

const PLATFORM_ADMIN_ROLES = ["sys-admin", "admin", "owner"] as const;

// it appeared that there is three sources of roles: app (user.app_metadata?.role), profile (profiles.role), and org_memberships.role
export const isPlatformAdminRole = (role: string): boolean => {
  return (PLATFORM_ADMIN_ROLES as readonly string[]).includes(role);
};

export type ProfileRoleFields = {
  role: string | null;
  default_org_id: string | null;
};

export const isOrgRole = (value: string): value is OrgRole => {
  return (ORG_ROLES as readonly string[]).includes(value);
};

export const isOrgAdminRole = (role: OrgRole): boolean => {
  return role === "owner" || role === "admin";
};

export const hasRoleAccess = (role: OrgRole, allowedRoles: readonly OrgRole[]): boolean => {
  if (isOrgAdminRole(role)) return true;
  if (role === "staff" && allowedRoles.includes("coach")) return true;
  return allowedRoles.includes(role);
};

const resolveRoleFromProfile = (profile: ProfileRoleFields | null, orgId: string): OrgRole | null => {
  if (!profile) return null;

  const role = typeof profile.role === "string" ? profile.role.trim() : "";
  if (!role) return null;

  const normalized = role.toLowerCase();
  if (normalized === "sys-admin") return "owner";

  if (profile.default_org_id === orgId && isOrgRole(role) && isOrgAdminRole(role)) {
    return role;
  }

  return null;
};

/**
 * Resolve the caller's organization role for `orgId`.
 * Pass a pre-loaded profile to skip the profiles query (e.g. login).
 * Returns `role: null` when the user has no active membership and no elevating profile role.
 * Returns `error` when a DB lookup fails (callers decide whether to fail open/closed).
 */
export const getOrgRole = async (
  userId: string,
  orgId: string,
  profile?: ProfileRoleFields | null,
): Promise<{ role: OrgRole | null; error: unknown }> => {
  const client = sbAdmin;
  if (!client) {
    return {
      role: null,
      error: new Error("Supabase admin client not configured"),
    };
  }

  let resolvedProfile: ProfileRoleFields | null;
  if (profile !== undefined) {
    resolvedProfile = profile;
  } else {
    const { data, error: profileError } = await client.from("profiles").select("role, default_org_id").eq("user_id", userId).maybeSingle();

    if (profileError) {
      return { role: null, error: profileError };
    }

    resolvedProfile = data
      ? {
          role: typeof data.role === "string" ? data.role : null,
          default_org_id: typeof data.default_org_id === "string" ? data.default_org_id : null,
        }
      : null;
  }

  const fromProfile = resolveRoleFromProfile(resolvedProfile, orgId);
  if (fromProfile) {
    return { role: fromProfile, error: null };
  }

  const { data, error } = await client
    .from("org_memberships")
    .select("role, is_active")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    return { role: null, error };
  }
  if (!data?.role || !data.is_active) {
    return { role: null, error: null };
  }
  if (!isOrgRole(data.role)) {
    return { role: null, error: null };
  }

  return { role: data.role, error: null };
};
