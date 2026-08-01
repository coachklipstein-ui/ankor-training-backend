import {
  BulkSkillDrillMapSchema,
  CreateSkillDrillMapSchema,
  normalizeSkillDrillMapBulkCreate,
  normalizeSkillDrillMapCreate,
  SkillDrillMapBySkillListSchema,
  SkillDrillMapListSchema,
  UpdateSkillDrillMapSchema,
} from "../dtos/skill_drill_map.dto.ts";
import {
  bulkChangeSkillDrillMaps,
  createSkillDrillMaps,
  deleteSkillDrillMap,
  listSkillDrillMaps,
  listSkillDrillMapsBySkill,
  updateSkillDrillMap,
} from "../services/skill_drill_map.service.ts";
import { badRequest, created, internalError, json, methodNotAllowed, notFound } from "../utils/http.ts";
import type { RequestContext } from "../routes/router.ts";
import { RE_UUID } from "../utils/uuid.ts";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unexpected error";
}

function validationMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues.map((issue) => issue.message).join("; ");
}

function queryValue(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key)?.trim();
  return value ? value : undefined;
}

export async function listSkillDrillMapsController(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const url = new URL(req.url);
  const raw = {
    org_id: ctx?.org_id ?? queryValue(url, "org_id"),
    skill_id: queryValue(url, "skill_id"),
    drill_id: queryValue(url, "drill_id"),
    limit: queryValue(url, "limit"),
    offset: queryValue(url, "offset"),
  };

  const parsed = SkillDrillMapListSchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest(validationMessage(parsed.error));
  }

  const { data, count, error, notFound: missing } = await listSkillDrillMaps(parsed.data);
  if (error) {
    if (missing) return notFound(getErrorMessage(error));
    console.error("[listSkillDrillMapsController] list error", error);
    return internalError(error, "Failed to list skill drill mappings");
  }

  return json(200, { ok: true, count, items: data });
}

export async function listSkillDrillMapsBySkillController(
  req: Request,
  _origin: string | null,
  params?: { skill_id?: string },
  _ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const skill_id = params?.skill_id?.trim() ?? "";
  if (!RE_UUID.test(skill_id)) {
    return badRequest("skill_id (UUID) is required");
  }

  const url = new URL(req.url);
  const raw = {
    skill_id,
    drill_id: queryValue(url, "drill_id"),
    limit: queryValue(url, "limit"),
    offset: queryValue(url, "offset"),
  };

  const parsed = SkillDrillMapBySkillListSchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest(validationMessage(parsed.error));
  }

  const { data, count, error } = await listSkillDrillMapsBySkill({
    ...parsed.data,
    skill_id,
  });
  if (error) {
    console.error("[listSkillDrillMapsBySkillController] list error", error);
    return internalError(error, "Failed to list skill drill mappings");
  }

  return json(200, { ok: true, count, items: data });
}

export async function createSkillDrillMapsController(
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

  const parsed = CreateSkillDrillMapSchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest(validationMessage(parsed.error));
  }

  if (ctx?.org_id && ctx.org_id !== parsed.data.org_id) {
    return badRequest("org_id does not match authorized organization");
  }

  const items = normalizeSkillDrillMapCreate(parsed.data);
  const {
    data,
    error,
    notFound: missing,
    conflict,
  } = await createSkillDrillMaps({
    org_id: parsed.data.org_id,
    skill_id: parsed.data.skill_id,
    items,
  });

  if (error) {
    if (missing) return notFound(getErrorMessage(error));
    if (conflict) {
      return json(409, { ok: false, error: "One or more mappings already exist" });
    }
    console.error("[createSkillDrillMapsController] create error", error);
    return internalError(error, "Failed to create skill drill mappings");
  }

  return created({ ok: true, count: data?.length ?? 0, items: data });
}

export async function bulkSkillDrillMapsController(
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

  const parsed = BulkSkillDrillMapSchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest(validationMessage(parsed.error));
  }

  if (ctx?.org_id && ctx.org_id !== parsed.data.org_id) {
    return badRequest("org_id does not match authorized organization");
  }

  const addItems = normalizeSkillDrillMapBulkCreate(parsed.data);
  const {
    data,
    error,
    notFound: missing,
  } = await bulkChangeSkillDrillMaps({
    org_id: parsed.data.org_id,
    skill_id: parsed.data.skill_id,
    addItems,
    removeDrillIds: parsed.data.remove_drill_ids,
  });

  if (error) {
    if (missing) return notFound(getErrorMessage(error));
    console.error("[bulkSkillDrillMapsController] bulk error", error);
    return internalError(error, "Failed to bulk update skill drill mappings");
  }

  return json(200, {
    ok: true,
    added_count: data?.added.length ?? 0,
    removed_count: data?.removed.length ?? 0,
    added: data?.added ?? [],
    removed: data?.removed ?? [],
  });
}

export async function updateSkillDrillMapController(
  req: Request,
  _origin: string | null,
  params?: { skill_id?: string; drill_id?: string },
  _ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "PATCH") {
    return methodNotAllowed(["PATCH"]);
  }

  const skill_id = params?.skill_id?.trim() ?? "";
  const drill_id = params?.drill_id?.trim() ?? "";
  if (!RE_UUID.test(skill_id)) return badRequest("skill_id (UUID) is required");
  if (!RE_UUID.test(drill_id)) return badRequest("drill_id (UUID) is required");

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return badRequest("Invalid JSON payload");
  }

  const parsed = UpdateSkillDrillMapSchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest(validationMessage(parsed.error));
  }

  const {
    data,
    error,
    notFound: missing,
  } = await updateSkillDrillMap({
    skill_id,
    drill_id,
    level: parsed.data.level ?? null,
  });

  if (error) {
    if (missing) return notFound(getErrorMessage(error));
    console.error("[updateSkillDrillMapController] update error", error);
    return internalError(error, "Failed to update skill drill mapping");
  }

  if (missing) return notFound("Skill drill mapping not found");

  return json(200, { ok: true, item: data });
}

export async function deleteSkillDrillMapController(
  req: Request,
  _origin: string | null,
  params?: { skill_id?: string; drill_id?: string },
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "DELETE") {
    return methodNotAllowed(["DELETE"]);
  }

  const skill_id = params?.skill_id?.trim() ?? "";
  const drill_id = params?.drill_id?.trim() ?? "";
  if (!RE_UUID.test(skill_id)) return badRequest("skill_id (UUID) is required");
  if (!RE_UUID.test(drill_id)) return badRequest("drill_id (UUID) is required");

  const url = new URL(req.url);
  const org_id = ctx?.org_id ?? queryValue(url, "org_id") ?? "";
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const {
    data,
    error,
    notFound: missing,
  } = await deleteSkillDrillMap({
    org_id,
    skill_id,
    drill_id,
  });

  if (error) {
    if (missing) return notFound(getErrorMessage(error));
    console.error("[deleteSkillDrillMapController] delete error", error);
    return internalError(error, "Failed to delete skill drill mapping");
  }

  if (missing) return notFound("Skill drill mapping not found");

  return json(200, { ok: true, item: data });
}
