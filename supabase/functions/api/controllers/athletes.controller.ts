import {
  AthleteListFilterSchema,
  CreateAthleteSchema,
  GetAthleteByIdSchema,
  UpdateAthleteSchema,
} from "../dtos/athletes.dto.ts";
import {
  createAthlete,
  deleteAthlete,
  getAthleteById,
  listAthletes,
  updateAthlete,
} from "../services/athletes.service.ts";
import { badRequest, created, internalError, json, methodNotAllowed, notFound } from "../utils/http.ts";
import type { RequestContext } from "../routes/router.ts";
import { RE_UUID } from "../utils/uuid.ts";

function qp(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function listAthletesController(
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
    team_id: (url.searchParams.get("team_id") ?? "").trim() || undefined,
    limit: qp(url, "limit"),
    offset: qp(url, "offset"),
  };

  const parsed = AthleteListFilterSchema.safeParse(rawFilters);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const { data, count, error } = await listAthletes(parsed.data);
  if (error) {
    console.error("[listAthletesController] list error", error);
    return internalError(error, "Failed to list athletes");
  }

  return json(200, { ok: true, count, items: data });
}

export async function createAthleteController(
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

  const parsed = CreateAthleteSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const { data, error } = await createAthlete(parsed.data);
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lowered = message.toLowerCase();
    if (lowered.includes("athlete email already exists")) {
      return badRequest("Athlete email already exists");
    }
    if (lowered.includes("already registered") || lowered.includes("duplicate")) {
      return json(409, { ok: false, error: "Email already registered" });
    }
    console.error("[createAthleteController] create error", error);
    return internalError(error, "Failed to create athlete");
  }

  return created({ ok: true, athlete: data });
}

export async function getAthleteByIdController(
  req: Request,
  _origin?: string | null,
  params?: { id?: string },
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const athlete_id = params?.id;
  if (!athlete_id) {
    return badRequest("Missing 'id' path parameter");
  }

  const idParsed = GetAthleteByIdSchema.safeParse({ athlete_id });
  if (!idParsed.success) {
    const message = idParsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const url = new URL(req.url);
  const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const { data, error } = await getAthleteById(idParsed.data.athlete_id, org_id);
  if (error) {
    console.error("[getAthleteByIdController] fetch error", error);
    return internalError(error, "Failed to fetch athlete");
  }

  if (!data) {
    return notFound("Athlete not found");
  }

  return json(200, { ok: true, athlete: data });
}

export async function updateAthleteController(
  req: Request,
  _origin?: string | null,
  params?: { id?: string },
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "PATCH") {
    return methodNotAllowed(["PATCH"]);
  }

  const athlete_id = params?.id;
  if (!athlete_id) {
    return badRequest("Missing 'id' path parameter");
  }

  const idParsed = GetAthleteByIdSchema.safeParse({ athlete_id });
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

  const parsed = UpdateAthleteSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const { data, error } = await updateAthlete(idParsed.data.athlete_id, org_id, parsed.data);
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("not found")) {
      return notFound("Athlete not found");
    }
    console.error("[updateAthleteController] update error", error);
    return internalError(error, "Failed to update athlete");
  }

  return json(200, { ok: true, athlete: data });
}

export async function deleteAthleteController(
  req: Request,
  _origin?: string | null,
  params?: { id?: string },
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "DELETE") {
    return methodNotAllowed(["DELETE"]);
  }

  const athlete_id = params?.id;
  if (!athlete_id) {
    return badRequest("Missing 'id' path parameter");
  }

  const idParsed = GetAthleteByIdSchema.safeParse({ athlete_id });
  if (!idParsed.success) {
    const message = idParsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const url = new URL(req.url);
  const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const { data, error } = await deleteAthlete(idParsed.data.athlete_id, org_id);
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("not found")) {
      return notFound("Athlete not found");
    }
    console.error("[deleteAthleteController] delete error", error);
    return internalError(error, "Failed to delete athlete");
  }

  return json(200, { ok: true, deleted: data });
}
