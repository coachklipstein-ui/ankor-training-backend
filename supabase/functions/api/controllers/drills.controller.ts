import {
  CreateDrillSchema,
  CreateDrillMediaSchema,
  DrillMediaBatchSchema,
  DrillMediaUploadSchema,
  normalizeCreateDrillDto,
  DrillListFilterSchema,
  GetDrillByIdSchema,
  UpdateDrillSchema,
} from "../dtos/drills.dto.ts";
import {
  createDrill,
  createDrillMedia,
  createDrillMediaUploadUrl,
  getDrillMediaPlaybackUrl,
  listDrillTags,
  listDrills,
  listSegments,
  getDrillById,
  uploadDrillMediaBatch,
  updateDrill,
} from "../services/drills.service.ts";
import {
  badRequest,
  created,
  internalError,
  methodNotAllowed,
  json,
  jsonResponse,
  unauthorized,
} from "../utils/http.ts";
import type { RequestContext } from "../routes/router.ts";
import { RE_UUID } from "../utils/uuid.ts";
import { requireOrgRole } from "../utils/auth.ts";

function qp(url: URL, key: string): string | undefined {
  const v = url.searchParams.get(key);
  const trimmed = v?.trim();
  return trimmed ? trimmed : undefined;
}

function parseCommaList(value: string | null, validator: (s: string) => boolean): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && validator(s));
}

function isUploadContentTypeValid(type: string, contentType: string): boolean {
  const normalized = contentType.toLowerCase();

  if (type === "video") return normalized.startsWith("video/");
  if (type === "image") return normalized.startsWith("image/");
  if (type === "document") return normalized.startsWith("application/");
  return true;
}

const MAX_BATCH_UPLOAD_BYTES = 10 * 1024 * 1024;

function contentLengthExceeds(req: Request, maxBytes: number): boolean {
  const raw = req.headers.get("content-length");
  if (!raw) return false;

  const length = Number.parseInt(raw, 10);
  return Number.isFinite(length) && length > maxBytes;
}

export async function createDrillController(
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

  const parsed = CreateDrillSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const userId = ctx?.user?.id;
  if (!userId) return unauthorized("Unauthorized");

  const dto = normalizeCreateDrillDto(parsed.data);
  dto.created_by = userId;

  const { data, error } = await createDrill(dto);

  if (error) {
    console.error("[createDrillController] rpc_create_drill error", error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("organization not found")) {
      return jsonResponse({ ok: false, error: "Organization not found" }, { status: 404 });
    }
    if (message.toLowerCase().includes("does not have a sport_id")) {
      return badRequest(message);
    }
    return internalError(error, "Failed to create drill");
  }

  const drill = Array.isArray(data) && data.length === 1 ? data[0] : (data ?? null);

  return created({ ok: true, drill });
}

export async function listDrillsController(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const url = new URL(req.url);
  const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const rawFilters = {
    org_id,
    name: (url.searchParams.get("name") ?? "").trim() || undefined,
    levels: parseCommaList(url.searchParams.get("levels"), (s) => s.length > 0),
    segment_ids: parseCommaList(url.searchParams.get("segment_ids"), (s) => RE_UUID.test(s)),
    min_age: url.searchParams.get("min_age"),
    max_age: url.searchParams.get("max_age"),
    min_players: url.searchParams.get("min_players"),
    max_players: url.searchParams.get("max_players"),
    skill_tag_ids: parseCommaList(url.searchParams.get("skill_tags"), (s) => RE_UUID.test(s)),
    limit: qp(url, "limit"),
    offset: qp(url, "offset"),
  };

  const parsed = DrillListFilterSchema.safeParse(rawFilters);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    return badRequest(msg);
  }

  const filters = parsed.data;
  const { data, count, error } = await listDrills(filters);

  if (error) {
    console.error("[listDrillsController] list error", error);
    return internalError(error, "Failed to list drills");
  }

  return json(200, { ok: true, count, items: data });
}

export async function listSegmentsController(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  _ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const { data, error } = await listSegments();
  if (error) {
    console.error("[listSegmentsController] list error", error);
    return internalError(error, "Failed to list segments");
  }

  return json(200, { ok: true, count: data.length, items: data });
}

export async function listDrillTagsController(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const url = new URL(req.url);
  const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const sport_id_raw = (url.searchParams.get("sport_id") ?? "").trim();
  if (sport_id_raw && !RE_UUID.test(sport_id_raw)) {
    return badRequest("sport_id must be a UUID if provided");
  }

  const q = (url.searchParams.get("q") ?? "").trim();
  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const rawOffset = Number.parseInt(url.searchParams.get("offset") ?? "", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : undefined;
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : undefined;

  const { data, count, error } = await listDrillTags({
    org_id,
    sport_id: sport_id_raw || undefined,
    q: q || undefined,
    limit,
    offset,
  });

  if (error) {
    console.error("[listDrillTagsController] list error", error);
    return internalError(error, "Failed to list drill tags");
  }

  return json(200, { ok: true, count, items: data });
}

export async function getDrillByIdController(
  req: Request,
  _origin: string | null,
  params?: { id?: string },
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const drill_id = params?.id;

  if (!drill_id) {
    return jsonResponse({ ok: false, error: "Missing 'id' path parameter" }, { status: 400 });
  }

  const parsed = GetDrillByIdSchema.safeParse({ drill_id });
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const url = new URL(req.url);
  const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const { data, error } = await getDrillById(parsed.data.drill_id, org_id);

  if (error) {
    console.error("[getDrillByIdController] Error fetching drill", error);
    return internalError(error, "Failed to fetch drill");
  }

  if (!data) {
    return jsonResponse({ ok: false, error: "Drill not found" }, { status: 404 });
  }

  return json(200, { ok: true, drill: data });
}

export async function updateDrillController(
  req: Request,
  _origin: string | null,
  params?: { id?: string },
  _ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "PATCH") {
    return methodNotAllowed(["PATCH"]);
  }

  const drill_id = params?.id;
  if (!drill_id) {
    return jsonResponse({ ok: false, error: "Missing 'id' path parameter" }, { status: 400 });
  }

  const idParsed = GetDrillByIdSchema.safeParse({ drill_id });
  if (!idParsed.success) {
    const message = idParsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return badRequest("Invalid JSON payload");
  }

  const parsed = UpdateDrillSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const { add_tag_ids, remove_tag_ids, ...rest } = parsed.data;
  const hasPatch = Object.values(rest).some((value) => value !== undefined);
  const hasTagOps = (add_tag_ids?.length ?? 0) > 0 || (remove_tag_ids?.length ?? 0) > 0;

  if (!hasPatch && !hasTagOps) {
    return badRequest("No updates provided");
  }

  const { data, error } = await updateDrill(drill_id, parsed.data);

  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("not found")) {
      return jsonResponse({ ok: false, error: "Drill not found" }, { status: 404 });
    }
    if (message.toLowerCase().includes("invalid drill tags")) {
      return badRequest(message);
    }
    return internalError(error, "Failed to update drill");
  }

  return json(200, { ok: true, drill: data });
}

export async function getDrillMediaPlaybackController(
  req: Request,
  _origin: string | null,
  params?: { drill_id?: string },
  _ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const drill_id = params?.drill_id;
  if (!drill_id) {
    return jsonResponse({ ok: false, error: "Missing 'drill_id' path parameter" }, { status: 400 });
  }

  const parsed = GetDrillByIdSchema.safeParse({ drill_id });
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const url = new URL(req.url);
  const rawExpires = url.searchParams.get("expires_in");
  const parsedExpires = rawExpires ? Number.parseInt(rawExpires, 10) : NaN;
  const expires_in = Number.isFinite(parsedExpires) ? Math.min(Math.max(parsedExpires, 60), 60 * 60 * 24) : 60 * 60;

  const { data, error } = await getDrillMediaPlaybackUrl(parsed.data.drill_id, expires_in);

  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("not found")) {
      return jsonResponse({ ok: false, error: "Drill media not found" }, { status: 404 });
    }
    return internalError(error, "Failed to create playback URL");
  }

  return json(200, {
    ok: true,
    media: data!.media,
    play_url: data!.play_url,
    expires_in: data!.expires_in,
  });
}

export async function createDrillMediaUploadUrlController(
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

  const parsed = DrillMediaUploadSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  if (parsed.data.type === "link") {
    return badRequest("type=link does not support uploads");
  }

  if (!isUploadContentTypeValid(parsed.data.type, parsed.data.content_type)) {
    return badRequest(`content_type does not match media type '${parsed.data.type}'`);
  }

  const { data, error } = await createDrillMediaUploadUrl(parsed.data);
  if (error || !data) {
    console.error("[createDrillMediaUploadUrlController] error", error);
    return internalError(error, "Failed to create upload URL");
  }

  const media = {
    type: parsed.data.type,
    url: data.public_url,
    title: parsed.data.title ?? null,
    description: parsed.data.description ?? null,
    thumbnail_url: parsed.data.thumbnail_url ?? null,
    position: parsed.data.position ?? null,
  };

  return created({ ok: true, upload: data, media });
}

export async function createDrillMediaController(
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

  const parsed = CreateDrillMediaSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const { data, error } = await createDrillMedia(parsed.data);
  if (error) {
    console.error("[createDrillMediaController] error", error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("not found")) {
      return jsonResponse({ ok: false, error: "Drill not found" }, { status: 404 });
    }
    return internalError(error, "Failed to create drill media");
  }

  return created({ ok: true, media: data });
}

export async function createDrillMediaBatchUploadController(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  if (contentLengthExceeds(req, MAX_BATCH_UPLOAD_BYTES)) {
    return json(413, {
      ok: false,
      error: "Batch upload payload is too large. Use /api/drills/media/upload-url for direct storage uploads.",
      max_bytes: MAX_BATCH_UPLOAD_BYTES,
    });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return badRequest("multipart/form-data payload is required");
  }

  const rawOrgId = form.get("org_id");
  const rawItems = form.get("items");
  if (typeof rawOrgId !== "string" || !rawOrgId.trim()) {
    return badRequest("org_id (UUID) is required");
  }
  if (typeof rawItems !== "string" || !rawItems.trim()) {
    return badRequest("items is required");
  }

  let parsedItems: unknown;
  try {
    parsedItems = JSON.parse(rawItems);
  } catch {
    return badRequest("items must be a valid JSON array");
  }

  const parsed = DrillMediaBatchSchema.safeParse({
    org_id: rawOrgId,
    items: parsedItems,
  });
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  if (!ctx?.user?.id) {
    return unauthorized("Unauthorized");
  }

  const access = await requireOrgRole(ctx.user.id, parsed.data.org_id, ["coach"]);
  if ("response" in access) return access.response;

  ctx.org_id = parsed.data.org_id;
  ctx.org_role = access.role;

  const uploadItems = [];
  for (const item of parsed.data.items) {
    const file = form.get(item.file_field);
    if (!(file instanceof File)) {
      return badRequest(`File field '${item.file_field}' is required`);
    }

    uploadItems.push({
      ...item,
      file,
    });
  }

  const { data, error } = await uploadDrillMediaBatch({
    org_id: parsed.data.org_id,
    items: uploadItems,
  });
  if (error || !data) {
    console.error("[createDrillMediaBatchUploadController] error", error);
    return internalError(error, "Failed to upload drill media batch");
  }

  return json(200, {
    ok: data.failed === 0,
    ...data,
  });
}
