import {
  CreateJoinCodeSchema,
  GetJoinCodeSchema,
  JoinCodeListFilterSchema,
  UpdateJoinCodeSchema,
} from "../dtos/join_codes.dto.ts";
import {
  createJoinCode,
  deleteJoinCode,
  getJoinCodeByCode,
  listJoinCodes,
  updateJoinCode,
} from "../services/join_codes.service.ts";
import { badRequest, created, internalError, json, methodNotAllowed, notFound } from "../utils/http.ts";
import type { RequestContext } from "../routes/router.ts";
import { RE_UUID } from "../utils/uuid.ts";

function qp(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function listJoinCodesController(
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
    team_id: qp(url, "team_id"),
    limit: qp(url, "limit"),
    offset: qp(url, "offset"),
  };

  const parsed = JoinCodeListFilterSchema.safeParse(rawFilters);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const { data, count, error } = await listJoinCodes(parsed.data);
  if (error) {
    console.error("[listJoinCodesController] list error", error);
    return internalError(error, "Failed to list join codes");
  }

  return json(200, { ok: true, count, items: data });
}

export async function getJoinCodeController(
  req: Request,
  _origin?: string | null,
  params?: { code?: string },
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const code = params?.code?.trim();
  if (!code) {
    return badRequest("Missing 'code' path parameter");
  }

  const parsed = GetJoinCodeSchema.safeParse({ code });
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const url = new URL(req.url);
  const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const { data, error } = await getJoinCodeByCode(parsed.data.code, org_id);
  if (error) {
    console.error("[getJoinCodeController] fetch error", error);
    return internalError(error, "Failed to fetch join code");
  }

  if (!data) {
    return notFound("Join code not found");
  }

  return json(200, { ok: true, join_code: data });
}

export async function createJoinCodeController(req: Request, _origin?: string | null): Promise<Response> {
  if (req.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return badRequest("Invalid JSON payload");
  }
  if (Object.prototype.hasOwnProperty.call(raw, "code")) {
    return badRequest("Join code is generated automatically; do not provide 'code'.");
  }

  const parsed = CreateJoinCodeSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const { data, error } = await createJoinCode(parsed.data);
  if (error) {
    console.error("[createJoinCodeController] create error", error);
    return internalError(error, "Failed to create join code");
  }

  return created({ ok: true, join_code: data });
}

export async function updateJoinCodeController(
  req: Request,
  _origin?: string | null,
  params?: { code?: string },
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "PATCH") {
    return methodNotAllowed(["PATCH"]);
  }

  const code = params?.code?.trim();
  if (!code) {
    return badRequest("Missing 'code' path parameter");
  }

  const codeParsed = GetJoinCodeSchema.safeParse({ code });
  if (!codeParsed.success) {
    const message = codeParsed.error.issues.map((issue) => issue.message).join("; ");
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

  const parsed = UpdateJoinCodeSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const { data, error } = await updateJoinCode(codeParsed.data.code, org_id, parsed.data);
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("not found")) {
      return notFound("Join code not found");
    }
    console.error("[updateJoinCodeController] update error", error);
    return internalError(error, "Failed to update join code");
  }

  return json(200, { ok: true, join_code: data });
}

export async function deleteJoinCodeController(
  req: Request,
  _origin?: string | null,
  params?: { code?: string },
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "DELETE") {
    return methodNotAllowed(["DELETE"]);
  }

  const code = params?.code?.trim();
  if (!code) {
    return badRequest("Missing 'code' path parameter");
  }

  const codeParsed = GetJoinCodeSchema.safeParse({ code });
  if (!codeParsed.success) {
    const message = codeParsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const url = new URL(req.url);
  const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const { data, error } = await deleteJoinCode(codeParsed.data.code, org_id);
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("not found")) {
      return notFound("Join code not found");
    }
    console.error("[deleteJoinCodeController] delete error", error);
    return internalError(error, "Failed to delete join code");
  }

  return json(200, { ok: true, deleted: data });
}
