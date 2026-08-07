import {
  CreatePlanSchema,
  GetPlanByIdSchema,
  InvitedPlanListSchema,
  InvitePlanMembersSchema,
  PlanListFilterSchema,
  UpdatePlanSchema,
} from "../dtos/plans.dto.ts";
import {
  createPlan,
  getPlanById,
  invitePlanMembers,
  listInvitedPlans,
  listPlansByType,
  updatePlan,
} from "../services/plans.service.ts";
import {
  badRequest,
  created,
  internalError,
  json,
  methodNotAllowed,
  notFound,
  forbidden,
  unauthorized,
} from "../utils/http.ts";
import type { RequestContext, RouteParams } from "../routes/router.ts";
import { isAdminRole, type OrgRole } from "../utils/auth.ts";
import { RE_UUID } from "../utils/uuid.ts";

function qp(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function listPlansController(
  req: Request,
  _origin: string | null = null,
  _params?: RouteParams,
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const url = new URL(req.url);
  const rawFilters = {
    org_id: (url.searchParams.get("org_id") ?? "").trim(),
    type: (url.searchParams.get("type") ?? "").trim(),
    user_id: (url.searchParams.get("user_id") ?? "").trim() || undefined,
    limit: qp(url, "limit"),
    offset: qp(url, "offset"),
  };

  const parsed = PlanListFilterSchema.safeParse(rawFilters);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  if (parsed.data.type === "org") {
    const role = ctx?.org_role as OrgRole | undefined;
    if (!role || !isAdminRole(role)) {
      return forbidden("Only organization admins can list all org plans");
    }
  }

  const { data, count, error } = await listPlansByType(parsed.data);
  if (error) {
    console.error("[listPlansController] list error", error);
    return internalError(error, "Failed to list plans");
  }

  return json(200, { ok: true, count, items: data });
}

export async function listInvitedPlansController(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const url = new URL(req.url);
  const rawFilters = {
    org_id: (url.searchParams.get("org_id") ?? "").trim(),
    user_id: (url.searchParams.get("user_id") ?? "").trim(),
    limit: qp(url, "limit"),
    offset: qp(url, "offset"),
  };

  const parsed = InvitedPlanListSchema.safeParse(rawFilters);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const { data, count, error } = await listInvitedPlans(parsed.data);
  if (error) {
    console.error("[listInvitedPlansController] list error", error);
    return internalError(error, "Failed to list invited plans");
  }

  return json(200, { ok: true, count, items: data });
}

export async function invitePlanMembersController(
  req: Request,
  _origin: string | null,
  params?: { id?: string },
  _ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  const plan_id = params?.id;
  if (!plan_id) {
    return badRequest("Missing 'id' path parameter");
  }

  const url = new URL(req.url);
  const org_id = (url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const idParsed = GetPlanByIdSchema.safeParse({ plan_id });
  if (!idParsed.success) {
    const message = idParsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return badRequest("Invalid JSON payload");
  }

  const parsed = InvitePlanMembersSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const { data, error } = await invitePlanMembers(plan_id, org_id, parsed.data);
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("not found")) {
      return notFound("Plan not found");
    }
    if (message.toLowerCase().includes("organization")) {
      return badRequest(message);
    }
    console.error("[invitePlanMembersController] invite error", error);
    return internalError(error, "Failed to invite plan members");
  }

  return json(200, {
    ok: true,
    plan_id,
    invited_user_ids: data?.invited_user_ids ?? [],
    skipped_user_ids: data?.skipped_user_ids ?? [],
  });
}

export async function getPlanByIdController(
  req: Request,
  _origin: string | null,
  params?: { id?: string },
  _ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const plan_id = params?.id;
  if (!plan_id) {
    return badRequest("Missing 'id' path parameter");
  }

  const url = new URL(req.url);
  const org_id = (url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const parsed = GetPlanByIdSchema.safeParse({ plan_id });
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const { data, error } = await getPlanById(parsed.data.plan_id, org_id);
  if (error) {
    console.error("[getPlanByIdController] fetch error", error);
    return internalError(error, "Failed to fetch plan");
  }

  if (!data) {
    return notFound("Plan not found");
  }

  return json(200, { ok: true, plan: data });
}

export async function updatePlanController(
  req: Request,
  _origin: string | null,
  params?: { id?: string },
  _ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "PATCH") {
    return methodNotAllowed(["PATCH"]);
  }

  const plan_id = params?.id;
  if (!plan_id) {
    return badRequest("Missing 'id' path parameter");
  }

  const url = new URL(req.url);
  const org_id = (url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const idParsed = GetPlanByIdSchema.safeParse({ plan_id });
  if (!idParsed.success) {
    const message = idParsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return badRequest("Invalid JSON payload");
  }

  const parsed = UpdatePlanSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const { data, error } = await updatePlan(plan_id, org_id, parsed.data);
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("not found")) {
      return notFound("Plan not found");
    }
    console.error("[updatePlanController] update error", error);
    return internalError(error, "Failed to update plan");
  }

  return json(200, { ok: true, plan: data });
}

export async function createPlanController(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return badRequest("Invalid JSON payload");
  }

  const parsed = CreatePlanSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const userId = ctx?.user?.id;
  if (!userId) {
    return unauthorized("Unauthorized");
  }

  const payload = {
    ...parsed.data,
    type: parsed.data.type ?? "custom",
  };

  if (payload.owner_user_id !== userId) {
    return forbidden("owner_user_id must match the authenticated user");
  }

  const { data, error } = await createPlan(payload);
  if (error) {
    console.error("[createPlanController] create error", error);
    return internalError(error, "Failed to create plan");
  }

  return created({ ok: true, plan: data });
}
