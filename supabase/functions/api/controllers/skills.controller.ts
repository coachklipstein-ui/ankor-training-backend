import { badRequest, json, notFound, serverError } from "../utils/responses.ts";
import {
  CreateSkillSchema,
  SkillMediaBatchSchema,
  SkillMediaCreateSchema,
  SkillMediaUploadSchema,
  UpdateSkillSchema,
} from "../dtos/skills.dto.ts";
import {
  createSkill,
  createSkillMedia,
  createSkillMediaUploadUrl,
  getSkillById,
  getSkillMediaPlaybackUrl,
  listSkills,
  uploadSkillMediaBatch,
  updateSkill,
} from "../services/skills.service.ts";
import type { RequestContext } from "../routes/router.ts";
import { isUuid } from "../utils/uuid.ts";
import { requireOrgRole } from "../utils/auth.ts";

function inferSkillMediaType(contentType: string): "video" | "image" | "document" {
  const normalized = contentType.toLowerCase();
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("image/")) return "image";
  return "document";
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
    const details = (err as { details?: unknown }).details;
    if (typeof details === "string") return details;
  }
  return "Unexpected error";
}

function parseStorageObjectUrl(value: string): { bucket: string; path: string } | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const prefix = "/storage/v1/object/";
  if (!url.pathname.startsWith(prefix)) return null;

  const rest = url.pathname.slice(prefix.length);
  const parts = rest.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const offset = parts[0] === "public" || parts[0] === "sign" ? 1 : 0;
  if (parts.length - offset < 2) return null;

  const bucket = parts[offset];
  const path = parts.slice(offset + 1).join("/");
  return { bucket, path };
}

export async function handleSkillCreate(
  req: Request,
  origin: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
) {
  if (req.method !== "POST") return badRequest("Method not allowed", origin);

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return badRequest("Invalid JSON payload", origin);
  }

  const parsed = CreateSkillSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message, origin);
  }

  if (ctx?.org_id && ctx.org_id !== parsed.data.org_id) {
    return badRequest("org_id does not match authorized organization", origin);
  }

  const { data, error } = await createSkill(parsed.data);
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    return serverError(message, origin);
  }

  return json({ ok: true, skill: data }, origin, 201);
}

export async function handleSkillMediaUploadUrl(
  req: Request,
  origin: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
) {
  if (req.method !== "POST") return badRequest("Method not allowed", origin);

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return badRequest("Invalid JSON payload", origin);
  }

  const parsed = SkillMediaUploadSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message, origin);
  }

  if (ctx?.org_id && ctx.org_id !== parsed.data.org_id) {
    return badRequest("org_id does not match authorized organization", origin);
  }

  const { data, error } = await createSkillMediaUploadUrl(parsed.data);
  if (error) {
    const message = getErrorMessage(error);
    if (message.toLowerCase().includes("not found")) {
      return notFound("Skill not found", origin);
    }
    return serverError(message, origin);
  }

  const media = {
    type: inferSkillMediaType(parsed.data.content_type),
    url: data!.public_url,
    title: parsed.data.title ?? null,
    description: parsed.data.description ?? null,
    thumbnail_url: parsed.data.thumbnail_url ?? null,
    position: parsed.data.position ?? null,
  };

  return json({ ok: true, upload: data, media }, origin, 201);
}

export async function handleSkillMediaCreate(
  req: Request,
  origin: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
) {
  if (req.method !== "POST") return badRequest("Method not allowed", origin);

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return badRequest("Invalid JSON payload", origin);
  }

  const parsed = SkillMediaCreateSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message, origin);
  }

  if (ctx?.org_id && ctx.org_id !== parsed.data.org_id) {
    return badRequest("org_id does not match authorized organization", origin);
  }

  let bucket = parsed.data.bucket ?? null;
  let object_path = parsed.data.object_path ?? parsed.data.storage_path ?? null;

  if (!object_path && parsed.data.url) {
    const parsedUrl = parseStorageObjectUrl(parsed.data.url);
    if (parsedUrl) {
      bucket = bucket ?? parsedUrl.bucket;
      object_path = parsedUrl.path;
    }
  }

  if (!object_path) {
    return badRequest("object_path or url is required", origin);
  }

  const { data, error } = await createSkillMedia({
    ...parsed.data,
    bucket: bucket ?? undefined,
    object_path,
  });
  if (error) {
    const message = getErrorMessage(error);
    if (message.toLowerCase().includes("not found")) {
      return notFound("Skill not found", origin);
    }
    if (message.toLowerCase().includes("invalid bucket")) {
      return badRequest(message, origin);
    }
    return serverError(message, origin);
  }

  return json({ ok: true, media: data }, origin, 201);
}

export async function handleSkillMediaBatchUpload(
  req: Request,
  origin: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
) {
  if (req.method !== "POST") return badRequest("Method not allowed", origin);

  const form = await req.formData().catch(() => null);
  if (!form) {
    return badRequest("multipart/form-data payload is required", origin);
  }

  const rawOrgId = form.get("org_id");
  const rawItems = form.get("items");
  if (typeof rawOrgId !== "string" || !rawOrgId.trim()) {
    return badRequest("org_id (UUID) is required", origin);
  }
  if (typeof rawItems !== "string" || !rawItems.trim()) {
    return badRequest("items is required", origin);
  }

  let parsedItems: unknown;
  try {
    parsedItems = JSON.parse(rawItems);
  } catch {
    return badRequest("items must be a valid JSON array", origin);
  }

  const parsed = SkillMediaBatchSchema.safeParse({
    org_id: rawOrgId,
    items: parsedItems,
  });
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message, origin);
  }

  if (!ctx?.user?.id) {
    return json({ ok: false, error: "Unauthorized" }, origin, 401);
  }

  const access = await requireOrgRole(ctx.user.id, parsed.data.org_id, ["coach"]);
  if ("response" in access) return access.response;

  ctx.org_id = parsed.data.org_id;
  ctx.org_role = access.role;

  const uploadItems = [];
  for (const item of parsed.data.items) {
    const file = form.get(item.file_field);
    if (!(file instanceof File)) {
      return badRequest(`File field '${item.file_field}' is required`, origin);
    }

    uploadItems.push({
      ...item,
      file,
    });
  }

  const { data, error } = await uploadSkillMediaBatch({
    org_id: parsed.data.org_id,
    items: uploadItems,
  });
  if (error || !data) {
    return serverError(getErrorMessage(error), origin);
  }

  return json(
    {
      ok: data.failed === 0,
      ...data,
    },
    origin,
    200,
  );
}

export async function handleSkillUpdate(
  req: Request,
  origin: string | null,
  params?: Record<string, string>,
  ctx?: RequestContext,
) {
  if (req.method !== "PATCH") return badRequest("Method not allowed", origin);

  const skill_id = params?.id ?? "";
  if (!isUuid(skill_id)) return badRequest("id (UUID) is required", origin);

  const url = new URL(req.url);
  const org_id = ctx?.org_id ?? url.searchParams.get("org_id") ?? "";
  if (!isUuid(org_id)) return badRequest("org_id (UUID) is required", origin);

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return badRequest("Invalid JSON payload", origin);
  }

  const parsed = UpdateSkillSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message, origin);
  }

  const hasPatch = Object.values(parsed.data).some((value) => value !== undefined);
  if (!hasPatch) {
    return badRequest("No updates provided", origin);
  }

  const { data, error } = await updateSkill(skill_id, org_id, parsed.data);
  if (error) {
    const message = getErrorMessage(error);
    if (message.toLowerCase().includes("not found")) {
      return notFound("Skill not found", origin);
    }
    if (message.toLowerCase().includes("no updates")) {
      return badRequest(message, origin);
    }
    return serverError(message, origin);
  }

  return json({ ok: true, skill: data }, origin, 200);
}

export async function handleSkillMediaPlayback(
  req: Request,
  origin: string | null,
  params?: Record<string, string>,
  _ctx?: RequestContext,
) {
  if (req.method !== "GET") return badRequest("Method not allowed", origin);

  const skill_id = params?.skill_id ?? "";
  if (!isUuid(skill_id)) return badRequest("skill_id (UUID) is required", origin);

  const url = new URL(req.url);

  const rawExpires = url.searchParams.get("expires_in");
  const parsedExpires = rawExpires ? Number.parseInt(rawExpires, 10) : NaN;
  const expires_in = Number.isFinite(parsedExpires) ? Math.min(Math.max(parsedExpires, 60), 60 * 60 * 24) : 60 * 60;

  const { data, error } = await getSkillMediaPlaybackUrl(skill_id, expires_in);
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("not found")) {
      return notFound("Skill media not found", origin);
    }
    return serverError(message, origin);
  }

  return json(
    {
      ok: true,
      media: data!.media,
      play_url: data!.play_url,
      expires_in: data!.expires_in,
    },
    origin,
    200,
  );
}

export async function handleSkillsList(
  req: Request,
  origin: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
) {
  if (req.method !== "GET") return badRequest("Method not allowed", origin);

  const url = new URL(req.url);
  const org_id = ctx?.org_id ?? url.searchParams.get("org_id") ?? "";
  const category = (url.searchParams.get("category") ?? "").trim();
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

  if (!isUuid(org_id)) return badRequest("org_id (UUID) is required", origin);

  const { data, count, error } = await listSkills({
    org_id,
    category: category || undefined,
    q,
    limit,
    offset,
  });
  if (error) return serverError(error.message, origin);

  return json({ ok: true, count, items: data ?? [] }, origin, 200);
}

export async function handleSkillById(
  req: Request,
  origin: string | null,
  params?: Record<string, string>,
  _ctx?: RequestContext,
) {
  if (req.method !== "GET") return badRequest("Method not allowed", origin);

  const skill_id = params?.id ?? "";
  if (!isUuid(skill_id)) return badRequest("id (UUID) is required", origin);

  const { data, error } = await getSkillById(skill_id);
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    return serverError(message, origin);
  }

  if (!data) return notFound("Skill not found", origin);

  return json({ ok: true, skill: data }, origin, 200);
}
