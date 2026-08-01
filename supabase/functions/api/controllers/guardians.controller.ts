import {
  CreateGuardianSchema,
  GetGuardianByIdSchema,
  GuardianListFilterSchema,
  UpdateGuardianSchema,
} from "../dtos/guardians.dto.ts";
import {
  createGuardian,
  deleteGuardian,
  getGuardianById,
  listGuardians,
  updateGuardian,
} from "../services/guardians.service.ts";
import { badRequest, created, internalError, json, methodNotAllowed, notFound } from "../utils/http.ts";
import type { RequestContext } from "../routes/router.ts";
import { RE_UUID } from "../utils/uuid.ts";

function qp(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function listGuardiansController(
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
    limit: qp(url, "limit"),
    offset: qp(url, "offset"),
  };

  const parsed = GuardianListFilterSchema.safeParse(rawFilters);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const { data, count, error } = await listGuardians(parsed.data);
  if (error) {
    console.error("[listGuardiansController] list error", error);
    return internalError(error, "Failed to list guardians");
  }

  return json(200, { ok: true, count, items: data });
}

export async function createGuardianController(
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

  const parsed = CreateGuardianSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const { data, error } = await createGuardian(parsed.data);
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lowered = message.toLowerCase();
    if (lowered.includes("user already exists")) {
      return badRequest("User already exists");
    }
    if (lowered.includes("guardian already exists")) {
      return badRequest("Guardian already exists");
    }
    if (lowered.includes("already registered") || lowered.includes("duplicate")) {
      return json(409, { ok: false, error: "Email already registered" });
    }
    console.error("[createGuardianController] create error", error);
    return internalError(error, "Failed to create guardian");
  }

  return created({ ok: true, guardian: data });
}

export async function getGuardianByIdController(
  req: Request,
  _origin?: string | null,
  params?: { id?: string },
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const guardian_id = params?.id;
  if (!guardian_id) {
    return badRequest("Missing 'id' path parameter");
  }

  const idParsed = GetGuardianByIdSchema.safeParse({ guardian_id });
  if (!idParsed.success) {
    const message = idParsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const url = new URL(req.url);
  const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const { data, error } = await getGuardianById(idParsed.data.guardian_id, org_id);
  if (error) {
    console.error("[getGuardianByIdController] fetch error", error);
    return internalError(error, "Failed to fetch guardian");
  }

  if (!data) {
    return notFound("Guardian not found");
  }

  return json(200, { ok: true, guardian: data });
}

export async function updateGuardianController(
  req: Request,
  _origin?: string | null,
  params?: { id?: string },
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "PATCH") {
    return methodNotAllowed(["PATCH"]);
  }

  const guardian_id = params?.id;
  if (!guardian_id) {
    return badRequest("Missing 'id' path parameter");
  }

  const idParsed = GetGuardianByIdSchema.safeParse({ guardian_id });
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

  const parsed = UpdateGuardianSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const { data, error } = await updateGuardian(idParsed.data.guardian_id, org_id, parsed.data);
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("not found")) {
      return notFound("Guardian not found");
    }
    console.error("[updateGuardianController] update error", error);
    return internalError(error, "Failed to update guardian");
  }

  return json(200, { ok: true, guardian: data });
}

export async function deleteGuardianController(
  req: Request,
  _origin?: string | null,
  params?: { id?: string },
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "DELETE") {
    return methodNotAllowed(["DELETE"]);
  }

  const guardian_id = params?.id;
  if (!guardian_id) {
    return badRequest("Missing 'id' path parameter");
  }

  const idParsed = GetGuardianByIdSchema.safeParse({ guardian_id });
  if (!idParsed.success) {
    const message = idParsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const url = new URL(req.url);
  const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const { data, error } = await deleteGuardian(idParsed.data.guardian_id, org_id);
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("not found")) {
      return notFound("Guardian not found");
    }
    console.error("[deleteGuardianController] delete error", error);
    return internalError(error, "Failed to delete guardian");
  }

  return json(200, { ok: true, deleted: data });
}
