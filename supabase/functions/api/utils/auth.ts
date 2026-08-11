import type { Middleware, RequestContext } from "../routes/router.ts";
import { sbAdmin, sbAnon } from "../services/supabase.ts";
import { getOrgRole, hasRoleAccess, isPlatformAdminRole, type OrgRole } from "./roles.ts";
import { forbidden, unauthorized } from "./http.ts";

export type { OrgRole } from "./roles.ts";
export { isOrgAdminRole } from "./roles.ts";

export type AuthUser = {
  id: string;
  email: string | null;
  app_metadata?: Record<string, unknown>;
};

function getBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return match[1].trim() || null;
}

export async function requireAuthUser(req: Request): Promise<{ user: AuthUser } | { response: Response }> {
  const token = getBearerToken(req);
  if (!token) return { response: unauthorized("Missing bearer token") };
  if (!sbAnon) return { response: unauthorized("Auth client not configured") };

  const { data, error } = await sbAnon.auth.getUser(token);
  if (error || !data?.user) {
    return { response: unauthorized("Invalid or expired token") };
  }

  return {
    user: {
      id: data.user.id,
      email: data.user.email ?? null,
      app_metadata: data.user.app_metadata ?? {},
    },
  };
}

export async function requireSysAdmin(user: AuthUser): Promise<{ ok: true } | { response: Response }> {
  const appRole = typeof user.app_metadata?.role === "string" ? user.app_metadata.role.trim().toLowerCase() : "";
  if (appRole === "sys-admin") return { ok: true };

  const client = sbAdmin;
  if (!client) return { response: forbidden("Auth admin client not configured") };

  const { data, error } = await client.from("profiles").select("role").eq("user_id", user.id).maybeSingle();

  if (error) return { response: forbidden("Unable to verify system role") };

  const profileRole = typeof data?.role === "string" ? data.role.trim().toLowerCase() : "";

  if (profileRole !== "sys-admin") {
    return { response: forbidden("Only sys-admin users can perform this action") };
  }

  return { ok: true };
}

export async function requireAnyAdmin(user: AuthUser): Promise<{ ok: true } | { response: Response }> {
  const appRole = typeof user.app_metadata?.role === "string" ? user.app_metadata.role.trim().toLowerCase() : "";
  if (isPlatformAdminRole(appRole)) return { ok: true };

  const client = sbAdmin;
  if (!client) return { response: forbidden("Auth admin client not configured") };

  const { data, error } = await client.from("profiles").select("role").eq("user_id", user.id).maybeSingle();

  if (error) return { response: forbidden("Unable to verify user role") };

  const profileRole = typeof data?.role === "string" ? data.role.trim().toLowerCase() : "";

  if (!isPlatformAdminRole(profileRole)) {
    return { response: forbidden("Only admin or sys-admin users can perform this action") };
  }

  return { ok: true };
}

async function ensureUser(req: Request, ctx: RequestContext): Promise<{ user: AuthUser } | { response: Response }> {
  if (ctx.user) return { user: ctx.user };
  const auth = await requireAuthUser(req);
  if ("response" in auth) return auth;
  ctx.user = auth.user;
  return auth;
}

export function authMiddleware(): Middleware {
  return async (req, _origin, _params, ctx) => {
    const auth = await ensureUser(req, ctx);
    if ("response" in auth) return auth.response;
    return null;
  };
}

export async function requireOrgRole(
  userId: string,
  orgId: string,
  allowedRoles: OrgRole[],
): Promise<{ role: OrgRole } | { response: Response }> {
  const { role, error } = await getOrgRole(userId, orgId);
  if (error) {
    return { response: forbidden("Unable to verify organization role") };
  }
  if (!role) {
    return { response: forbidden("No access to this organization") };
  }
  if (!hasRoleAccess(role, allowedRoles)) {
    return { response: forbidden("Insufficient role for this action") };
  }
  return { role };
}
