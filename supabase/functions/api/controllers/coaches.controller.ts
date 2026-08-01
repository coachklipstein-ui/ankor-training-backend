import {
  CoachListFilterSchema,
  CreateCoachSchema,
  GetCoachByIdSchema,
  UpdateCoachSchema,
} from "../dtos/coaches.dto.ts";
import {
  createCoach,
  deleteCoach,
  getCoachById,
  getCoachSummary,
  listCoaches,
  updateCoach,
} from "../services/coaches.service.ts";
import { badRequest, created, internalError, json, methodNotAllowed, notFound } from "../utils/http.ts";
import type { RequestContext } from "../routes/router.ts";
import { RE_UUID } from "../utils/uuid.ts";

function qp(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function listCoachesController(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const url = new URL(req.url);
  const rawFilters = {
    org_id: (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim(),
    name: (url.searchParams.get("name") ?? "").trim() || undefined,
    email: (url.searchParams.get("email") ?? "").trim() || undefined,
    limit: qp(url, "limit"),
    offset: qp(url, "offset"),
  };

  const parsed = CoachListFilterSchema.safeParse(rawFilters);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const { data, count, error } = await listCoaches(parsed.data);
  if (error) {
    console.error("[listCoachesController] list error", error);
    return internalError(error, "Failed to list coaches");
  }

  const items = data.map(({ first_name: _first, last_name: _last, ...rest }) => rest);
  return json(200, { ok: true, count, items });
}

export async function createCoachController(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  _ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return badRequest("Invalid JSON payload");
  }

  const parsed = CreateCoachSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const { data, error } = await createCoach(parsed.data);
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lowered = message.toLowerCase();
    if (lowered.includes("already registered") || lowered.includes("duplicate")) {
      return json(409, { ok: false, error: "Email already registered" });
    }
    console.error("[createCoachController] create error", error);
    return internalError(error, "Failed to create coach");
  }

  return created({ ok: true, coach: data });
}

export async function getCoachByIdController(
  req: Request,
  _origin?: string | null,
  params?: { id?: string },
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const coach_id = params?.id;
  if (!coach_id) {
    return badRequest("Missing 'id' path parameter");
  }

  const idParsed = GetCoachByIdSchema.safeParse({ coach_id });
  if (!idParsed.success) {
    const message = idParsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const url = new URL(req.url);
  const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const { data, error } = await getCoachById(idParsed.data.coach_id, org_id);
  if (error) {
    console.error("[getCoachByIdController] fetch error", error);
    return internalError(error, "Failed to fetch coach");
  }

  if (!data) {
    return notFound("Coach not found");
  }

  return json(200, { ok: true, coach: data });
}

export async function getCoachSummaryController(
  req: Request,
  _origin?: string | null,
  params?: { id?: string },
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const coach_id = params?.id;
  if (!coach_id) {
    return badRequest("Missing 'id' path parameter");
  }

  const idParsed = GetCoachByIdSchema.safeParse({ coach_id });
  if (!idParsed.success) {
    const message = idParsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const url = new URL(req.url);
  const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const { data, error } = await getCoachSummary(org_id, idParsed.data.coach_id);
  if (error) {
    console.error("[getCoachSummaryController] fetch error", error);
    return internalError(error, "Failed to fetch coach summary");
  }

  return json(200, {
    ok: true,
    data: data ?? {
      total_teams: 0,
      total_athletes: 0,
      total_evaluations: 0,
      total_plans_share: 0,
    },
  });
}

export async function updateCoachController(
  req: Request,
  _origin?: string | null,
  params?: { id?: string },
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "PATCH") {
    return methodNotAllowed(["PATCH"]);
  }

  const coach_id = params?.id;
  if (!coach_id) {
    return badRequest("Missing 'id' path parameter");
  }

  const idParsed = GetCoachByIdSchema.safeParse({ coach_id });
  if (!idParsed.success) {
    const message = idParsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const url = new URL(req.url);
  const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return badRequest("Invalid JSON payload");
  }

  const parsed = UpdateCoachSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const { data, error } = await updateCoach(idParsed.data.coach_id, org_id, parsed.data);
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("not found")) {
      return notFound("Coach not found");
    }
    console.error("[updateCoachController] update error", error);
    return internalError(error, "Failed to update coach");
  }

  return json(200, { ok: true, coach: data });
}

export async function deleteCoachController(
  req: Request,
  _origin?: string | null,
  params?: { id?: string },
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "DELETE") {
    return methodNotAllowed(["DELETE"]);
  }

  const coach_id = params?.id;
  if (!coach_id) {
    return badRequest("Missing 'id' path parameter");
  }

  const idParsed = GetCoachByIdSchema.safeParse({ coach_id });
  if (!idParsed.success) {
    const message = idParsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const url = new URL(req.url);
  const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const { data, error } = await deleteCoach(idParsed.data.coach_id, org_id);
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("not found")) {
      return notFound("Coach not found");
    }
    console.error("[deleteCoachController] delete error", error);
    return internalError(error, "Failed to delete coach");
  }

  return json(200, { ok: true, deleted: data });
}
