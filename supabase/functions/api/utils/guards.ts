import type { Middleware } from "../routes/router.ts";
import { getPlanAccess, isPlanMember } from "../services/plans.service.ts";
import { RE_UUID } from "./uuid.ts";
import { badRequest, forbidden, internalError, notFound, unauthorized } from "./http.ts";
import { requireAdminOrSysAdmin, requireOrgRole, requireSysAdmin, type OrgRole } from "./auth.ts";

function getUserId(ctx: { user?: { id: string } }): string | Response {
  if (!ctx.user) return unauthorized("Unauthorized");
  return ctx.user.id;
}

export function orgRoleGuardFromQuery(paramName: string, allowedRoles: OrgRole[]): Middleware {
  return async (req, _origin, _params, ctx) => {
    const org_id = (new URL(req.url).searchParams.get(paramName) ?? "").trim();
    if (!RE_UUID.test(org_id)) {
      return badRequest(`${paramName} (UUID) is required`);
    }

    const userId = getUserId(ctx);
    if (userId instanceof Response) return userId;

    const access = await requireOrgRole(userId, org_id, allowedRoles);
    if ("response" in access) return access.response;

    ctx.org_id = org_id;
    ctx.org_role = access.role;
    return null;
  };
}

export function sysAdminGuard(): Middleware {
  return async (_req, _origin, _params, ctx) => {
    if (!ctx.user) return unauthorized("Unauthorized");
    const access = await requireSysAdmin(ctx.user);
    if ("response" in access) return access.response;
    return null;
  };
}

export function adminOrSysAdminGuard(): Middleware {
  return async (_req, _origin, _params, ctx) => {
    if (!ctx.user) return unauthorized("Unauthorized");
    const access = await requireAdminOrSysAdmin(ctx.user);
    if ("response" in access) return access.response;
    return null;
  };
}

export function orgRoleGuardFromBody(
  key: string,
  allowedRoles: OrgRole[],
  options: { allowNull?: boolean; optional?: boolean } = {},
): Middleware {
  return async (req, _origin, _params, ctx) => {
    const raw = await req
      .clone()
      .json()
      .catch(() => null);
    if (!raw || typeof raw !== "object") {
      return badRequest("Invalid JSON payload");
    }

    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined || value === null) {
      if (options.allowNull || options.optional) return null;
      return badRequest(`${key} (UUID) is required`);
    }
    if (typeof value !== "string" || !RE_UUID.test(value)) {
      return badRequest(`${key} (UUID) is required`);
    }

    const userId = getUserId(ctx);
    if (userId instanceof Response) return userId;

    const access = await requireOrgRole(userId, value, allowedRoles);
    if ("response" in access) return access.response;

    ctx.org_id = value;
    ctx.org_role = access.role;
    return null;
  };
}

export function evaluationBulkOrgGuard(allowedRoles: OrgRole[]): Middleware {
  return async (req, _origin, _params, ctx) => {
    const raw = await req
      .clone()
      .json()
      .catch(() => null);
    if (!raw || typeof raw !== "object") {
      return badRequest("Body must contain an 'evaluations' array.");
    }

    const evaluations = (raw as Record<string, unknown>).evaluations;
    if (!Array.isArray(evaluations) || evaluations.length === 0) {
      return badRequest("Body must contain an 'evaluations' array.");
    }

    const orgIds = new Set(
      evaluations
        .map((item) => (item as Record<string, unknown>)?.org_id)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim()),
    );

    if (orgIds.size !== 1) {
      return badRequest("All evaluations must share the same org_id.");
    }

    const org_id = [...orgIds][0];
    if (!RE_UUID.test(org_id)) {
      return badRequest("org_id (UUID) is required");
    }

    const userId = getUserId(ctx);
    if (userId instanceof Response) return userId;

    const access = await requireOrgRole(userId, org_id, allowedRoles);
    if ("response" in access) return access.response;

    ctx.org_id = org_id;
    ctx.org_role = access.role;
    return null;
  };
}

export function userQueryGuard(paramName: string, options: { allowMissing?: boolean } = {}): Middleware {
  return async (req, _origin, _params, ctx) => {
    const userIdParam = (new URL(req.url).searchParams.get(paramName) ?? "").trim();
    if (!userIdParam) {
      return options.allowMissing ? null : badRequest(`${paramName} (UUID) is required`);
    }
    if (!RE_UUID.test(userIdParam)) {
      return badRequest(`${paramName} (UUID) is required`);
    }

    const userId = getUserId(ctx);
    if (userId instanceof Response) return userId;

    if (userIdParam !== userId) {
      return forbidden("Forbidden");
    }

    return null;
  };
}

export function planReadGuard(): Middleware {
  return async (_req, _origin, params, ctx) => {
    const planId = params?.id ?? "";
    if (!RE_UUID.test(planId)) {
      return badRequest("id (UUID) is required");
    }

    const userId = getUserId(ctx);
    if (userId instanceof Response) return userId;

    const { data, error } = await getPlanAccess(planId);
    if (error) return internalError(error);
    if (!data) return notFound("Plan not found");

    const requestedOrgId = ctx?.org_id;
    if (requestedOrgId && data.org_id && requestedOrgId !== data.org_id) {
      return forbidden("Forbidden");
    }

    if (data.owner_user_id === userId) return null;

    const member = await isPlanMember(planId, userId);
    if (member.error) return internalError(member.error);
    if (member.data) return null;

    if (data.org_id) {
      const access = await requireOrgRole(userId, data.org_id, ["coach"]);
      if ("response" in access) return access.response;
      ctx.org_id = data.org_id;
      ctx.org_role = access.role;
      return null;
    }

    return forbidden("Forbidden");
  };
}

export function planWriteGuard(): Middleware {
  return async (_req, _origin, params, ctx) => {
    const planId = params?.id ?? "";
    if (!RE_UUID.test(planId)) {
      return badRequest("id (UUID) is required");
    }

    const userId = getUserId(ctx);
    if (userId instanceof Response) return userId;

    const { data, error } = await getPlanAccess(planId);
    if (error) return internalError(error);
    if (!data) return notFound("Plan not found");

    const requestedOrgId = ctx?.org_id;
    if (requestedOrgId && data.org_id && requestedOrgId !== data.org_id) {
      return forbidden("Forbidden");
    }

    if (data.owner_user_id === userId) return null;

    if (data.org_id) {
      const access = await requireOrgRole(userId, data.org_id, ["coach"]);
      if ("response" in access) return access.response;
      ctx.org_id = data.org_id;
      ctx.org_role = access.role;
      return null;
    }

    return forbidden("Forbidden");
  };
}

export function planCreateGuard(): Middleware {
  return async (req, _origin, _params, ctx) => {
    const raw = await req
      .clone()
      .json()
      .catch(() => null);
    if (!raw || typeof raw !== "object") {
      return badRequest("Invalid JSON payload");
    }

    const value = (raw as Record<string, unknown>).org_id;
    if (value === null || value === undefined || value === "") {
      return null;
    }
    if (typeof value !== "string" || !RE_UUID.test(value)) {
      return badRequest("org_id (UUID) is required");
    }

    const userId = getUserId(ctx);
    if (userId instanceof Response) return userId;

    const access = await requireOrgRole(userId, value, ["coach", "athlete", "parent"]);
    if ("response" in access) return access.response;

    ctx.org_id = value;
    ctx.org_role = access.role;
    return null;
  };
}
