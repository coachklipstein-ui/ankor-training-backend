import { sbAdmin } from "./supabase.ts";
import {
  type SkillMediaBatchInput,
  type SkillMediaBatchItemResult,
  type SkillMediaBatchResult,
  type CreateSkillInput,
  type SkillMediaCreateInput,
  type SkillMediaPlaybackDto,
  type SkillMediaRecordDto,
  type SkillMediaUploadInput,
  type SkillMediaUploadResult,
  type UpdateSkillInput,
} from "../dtos/skills.dto.ts";
import { SKILLS_MEDIA_BUCKET } from "../config/env.ts";

function toNullableTrimmed(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/ogg": ".ogv",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

function sanitizeFileName(name: string): string {
  const base = name.trim().split(/[\\/]/).pop() ?? "upload";
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe.length ? safe : "upload";
}

function inferExtension(fileName: string, contentType: string): string {
  const match = fileName.match(/\.([a-z0-9]{1,10})$/i);
  if (match) {
    return `.${match[1].toLowerCase()}`;
  }

  const mapped = EXTENSION_BY_CONTENT_TYPE[contentType.toLowerCase()];
  return mapped ?? ".bin";
}

function normalizeFileHash(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function buildSkillMediaPath(input: {
  org_id: string;
  skill_id: string;
  file_name: string;
  content_type: string;
  file_hash?: string | null;
}): string {
  const safeName = sanitizeFileName(input.file_name);
  const extension = inferExtension(safeName, input.content_type);
  const fileId = normalizeFileHash(input.file_hash) ?? crypto.randomUUID();
  return `orgs/${input.org_id}/skills/${input.skill_id}/${fileId}${extension}`;
}

function resolveSkillsBucket(value?: string | null): string | null {
  if (!value) return SKILLS_MEDIA_BUCKET;
  const trimmed = value.trim();
  if (!trimmed) return SKILLS_MEDIA_BUCKET;

  const normalized = trimmed.toLowerCase();
  const target = SKILLS_MEDIA_BUCKET.toLowerCase();
  if (normalized === target) return SKILLS_MEDIA_BUCKET;
  if (normalized === "skills_media" || normalized === "skills-media") {
    return SKILLS_MEDIA_BUCKET;
  }
  if (trimmed.toUpperCase() === "SKILLS_MEDIA") return SKILLS_MEDIA_BUCKET;
  if (trimmed.toUpperCase() === "SKILLS_MEDIA_BUCKET") return SKILLS_MEDIA_BUCKET;
  if (normalized === "skills_media_bucket") return SKILLS_MEDIA_BUCKET;

  return null;
}

async function ensureSkillOrg(skill_id: string, org_id: string): Promise<{ error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await client
    .from("skills")
    .select("id")
    .eq("id", skill_id)
    .eq("org_id", org_id)
    .maybeSingle();

  if (error) {
    return { error };
  }

  if (!data) {
    return { error: new Error("Skill not found") };
  }

  return { error: null };
}

function mapSkillMediaRow(row: any, fallbackBucket: string | null): SkillMediaRecordDto {
  const url = typeof row?.url === "string" ? row.url : "";
  const parsed = url ? parseStorageObjectUrl(url) : null;
  const bucket = typeof row?.bucket === "string" ? row.bucket : (parsed?.bucket ?? fallbackBucket);
  const object_path = row?.object_path ?? row?.storage_path ?? parsed?.path ?? "";
  const position =
    typeof row?.position === "number" ? row.position : typeof row?.sort_order === "number" ? row.sort_order : null;

  return {
    id: row?.id ?? "",
    skill_id: row?.skill_id ?? "",
    bucket: bucket ?? null,
    object_path,
    url: url || null,
    title: row?.title ?? null,
    description: row?.description ?? null,
    thumbnail_url: row?.thumbnail_url ?? null,
    position,
    media_type: row?.media_type ?? row?.type ?? null,
  };
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

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
    const error = (err as { error?: unknown }).error;
    if (typeof error === "string") return error;
  }
  return "Unexpected error";
}

function resolveBatchVideoContentType(file: File): string | null {
  const type = file.type.trim().toLowerCase();
  if (type === "video/mp4") return type;
  if (type === "video/quicktime") return type;

  const name = (file.name ?? "").trim().toLowerCase();
  if (name.endsWith(".mp4")) return "video/mp4";
  if (name.endsWith(".mov")) return "video/quicktime";

  return null;
}

async function getExistingSkillMediaByUrl(
  skill_id: string,
  url: string,
): Promise<{ data: SkillMediaRecordDto | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const normalizedUrl = url.trim();
  if (!normalizedUrl) {
    return { data: null, error: null };
  }

  const { data, error } = await client
    .from("skill_media")
    .select("id, skill_id, media_type, url, title, thumbnail_url, sort_order")
    .eq("skill_id", skill_id)
    .eq("url", normalizedUrl)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };
  return { data: mapSkillMediaRow(data, null), error: null };
}

async function removeSkillMediaObject(bucket: string, objectPath: string): Promise<void> {
  const client = sbAdmin;
  if (!client) return;

  await client.storage.from(bucket).remove([objectPath]);
}

async function removeOtherSkillVideoMedia(
  skill_id: string,
  keepMediaId: string,
  keepUrl: string,
): Promise<{ error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { error: new Error("Supabase client not initialized") };
  }

  const { data: removedRows, error } = await client
    .from("skill_media")
    .delete()
    .eq("skill_id", skill_id)
    .eq("media_type", "video")
    .neq("id", keepMediaId)
    .select("url");

  if (error) {
    return { error };
  }

  for (const row of removedRows ?? []) {
    const url = typeof row?.url === "string" ? row.url : "";
    if (!url || url === keepUrl) continue;

    const parsed = parseStorageObjectUrl(url);
    if (!parsed) continue;

    await removeSkillMediaObject(parsed.bucket, parsed.path).catch((err) => {
      console.error("[removeOtherSkillVideoMedia] failed to remove storage object", err);
    });
  }

  return { error: null };
}

type SkillMediaBatchUploadItem = SkillMediaBatchInput["items"][number] & {
  file: File;
};

export async function listSkills(params: {
  org_id: string;
  category?: string;
  q?: string;
  limit?: number;
  offset?: number;
}) {
  const { org_id, category, q, limit = 50, offset = 0 } = params;

  const { data: orgRow, error: orgError } = await sbAdmin!
    .from("organizations")
    .select("sport_id")
    .eq("id", org_id)
    .maybeSingle();

  if (orgError) {
    return { data: [], count: 0, error: orgError };
  }

  const sportId = orgRow?.sport_id ?? null;
  if (!sportId) {
    return { data: [], count: 0, error: null };
  }

  let query = sbAdmin!
    .from("skills")
    .select("id, org_id, sport_id, category, title, description, level, visibility, status, created_at, updated_at", {
      count: "exact",
    })
    .eq("sport_id", sportId)
    .order("title", { ascending: true })
    .range(offset, offset + (limit - 1));

  if (category?.trim()) query = query.ilike("category", category.trim());
  if (q?.trim()) query = query.or(`title.ilike.%${q}%,category.ilike.%${q}%`);

  return await query;
}

export async function getSkillById(skill_id: string) {
  return await sbAdmin!
    .from("skills")
    .select("id, org_id, sport_id, category, title, description, level, visibility, status, created_at, updated_at")
    .eq("id", skill_id)
    .maybeSingle();
}

export async function createSkill(input: CreateSkillInput): Promise<{ data: any | null; error: unknown }> {
  if (!sbAdmin) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const payload = {
    org_id: input.org_id,
    sport_id: input.sport_id ?? null,
    category: input.category.trim(),
    title: input.title.trim(),
    description: toNullableTrimmed(input.description),
    level: toNullableTrimmed(input.level),
    visibility: toNullableTrimmed(input.visibility),
    status: toNullableTrimmed(input.status),
  };

  const { data, error } = await sbAdmin
    .from("skills")
    .insert(payload)
    .select("id, org_id, sport_id, category, title, description, level, visibility, status, created_at, updated_at")
    .maybeSingle();

  if (error) return { data: null, error };
  if (!data) return { data: null, error: new Error("Failed to create skill") };

  return { data, error: null };
}

export async function updateSkill(
  skill_id: string,
  org_id: string,
  input: UpdateSkillInput,
): Promise<{ data: any | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const patch: Record<string, unknown> = {};

  if (input.sport_id !== undefined) patch.sport_id = input.sport_id ?? null;
  if (input.category !== undefined) patch.category = input.category.trim();
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.description !== undefined) patch.description = toNullableTrimmed(input.description);
  if (input.level !== undefined) patch.level = toNullableTrimmed(input.level);
  if (input.visibility !== undefined) patch.visibility = toNullableTrimmed(input.visibility);
  if (input.status !== undefined) patch.status = toNullableTrimmed(input.status);

  if (Object.keys(patch).length === 0) {
    return { data: null, error: new Error("No updates provided") };
  }

  const { data, error } = await client
    .from("skills")
    .update(patch)
    .eq("id", skill_id)
    .eq("org_id", org_id)
    .select("id, org_id, sport_id, category, title, description, level, visibility, status, created_at, updated_at")
    .maybeSingle();

  if (error) return { data: null, error };
  if (!data) return { data: null, error: new Error("Skill not found") };

  return { data, error: null };
}

export async function createSkillMediaUploadUrl(
  input: SkillMediaUploadInput,
): Promise<{ data: SkillMediaUploadResult | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { error: skillError } = await ensureSkillOrg(input.skill_id, input.org_id);
  if (skillError) {
    return { data: null, error: skillError };
  }

  const path = buildSkillMediaPath(input);
  const bucket = SKILLS_MEDIA_BUCKET;

  const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(path);

  if (error || !data?.signedUrl || !data.token) {
    return { data: null, error: error ?? new Error("Failed to create upload URL") };
  }

  const publicResult = client.storage.from(bucket).getPublicUrl(path);
  const public_url = publicResult.data?.publicUrl ?? "";

  return {
    data: {
      bucket,
      object_path: path,
      signed_url: data.signedUrl,
      token: data.token,
      public_url,
    },
    error: null,
  };
}

export async function createSkillMedia(
  input: SkillMediaCreateInput,
): Promise<{ data: SkillMediaRecordDto | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { error: skillError } = await ensureSkillOrg(input.skill_id, input.org_id);
  if (skillError) {
    return { data: null, error: skillError };
  }

  const media_type = (input.media_type ?? "video").trim();
  let position = input.position ?? null;

  let url = typeof input.url === "string" ? input.url.trim() : "";
  if (!url) {
    const objectPath = input.object_path?.trim() ?? "";
    if (!objectPath) {
      return { data: null, error: new Error("url or object_path is required") };
    }
    const bucket = resolveSkillsBucket(input.bucket);
    if (!bucket) {
      return { data: null, error: new Error("Invalid bucket") };
    }
    const publicResult = client.storage.from(bucket).getPublicUrl(objectPath);
    url = publicResult.data?.publicUrl ?? "";
    if (!url) {
      return { data: null, error: new Error("Failed to resolve media URL") };
    }
  }

  const { data: existing, error: existingError } = await getExistingSkillMediaByUrl(input.skill_id, url);
  if (existingError) {
    return { data: null, error: existingError };
  }
  if (existing) {
    return { data: existing, error: null };
  }

  if (position === null || position === undefined) {
    const { data: lastRow, error: lastError } = await client
      .from("skill_media")
      .select("sort_order")
      .eq("skill_id", input.skill_id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastError) {
      return { data: null, error: lastError };
    }

    const lastOrder = typeof lastRow?.sort_order === "number" ? lastRow.sort_order : null;
    position = lastOrder !== null ? lastOrder + 1 : 1;
  }

  const { data, error } = await client
    .from("skill_media")
    .insert({
      skill_id: input.skill_id,
      media_type,
      url,
      title: input.title ?? null,
      thumbnail_url: input.thumbnail_url ?? null,
      sort_order: position ?? null,
    })
    .select("id, skill_id, media_type, url, title, thumbnail_url, sort_order")
    .single();

  if (error) {
    return { data: null, error };
  }

  if (media_type === "video") {
    const { error: replaceError } = await removeOtherSkillVideoMedia(input.skill_id, data.id, url);

    if (replaceError) {
      return { data: null, error: replaceError };
    }
  }

  return { data: mapSkillMediaRow(data, null), error: null };
}

export async function uploadSkillMediaBatch(input: {
  org_id: string;
  items: SkillMediaBatchUploadItem[];
}): Promise<{ data: SkillMediaBatchResult | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const results: SkillMediaBatchItemResult[] = [];

  for (const item of input.items) {
    const fileName = sanitizeFileName(item.file.name || `${item.file_field}.mp4`);
    const contentType = resolveBatchVideoContentType(item.file);

    if (!contentType) {
      results.push({
        file_field: item.file_field,
        file_name: fileName,
        skill_id: item.skill_id,
        status: "failed",
        reason: "Only .mp4 and .mov videos are supported",
        upload: null,
        media: null,
      });
      continue;
    }

    const { data: upload, error: uploadUrlError } = await createSkillMediaUploadUrl({
      org_id: input.org_id,
      skill_id: item.skill_id,
      file_name: fileName,
      content_type: contentType,
      title: item.title,
      description: item.description,
      thumbnail_url: item.thumbnail_url,
      position: item.position,
    });

    if (uploadUrlError || !upload) {
      results.push({
        file_field: item.file_field,
        file_name: fileName,
        skill_id: item.skill_id,
        status: "failed",
        reason: getErrorMessage(uploadUrlError),
        upload: null,
        media: null,
      });
      continue;
    }

    let uploadedToStorage = false;
    const { error: storageError } = await client.storage
      .from(upload.bucket)
      .uploadToSignedUrl(upload.object_path, upload.token, item.file, {
        contentType,
      });

    if (storageError) {
      results.push({
        file_field: item.file_field,
        file_name: fileName,
        skill_id: item.skill_id,
        status: "failed",
        reason: getErrorMessage(storageError),
        upload,
        media: null,
      });
      continue;
    } else {
      uploadedToStorage = true;
    }

    const { data: media, error: mediaError } = await createSkillMedia({
      org_id: input.org_id,
      skill_id: item.skill_id,
      bucket: upload.bucket,
      object_path: upload.object_path,
      media_type: "video",
      title: item.title,
      description: item.description,
      thumbnail_url: item.thumbnail_url,
      position: item.position,
    });

    if (mediaError || !media) {
      if (uploadedToStorage) {
        await removeSkillMediaObject(upload.bucket, upload.object_path);
      }
      results.push({
        file_field: item.file_field,
        file_name: fileName,
        skill_id: item.skill_id,
        status: "failed",
        reason: getErrorMessage(mediaError),
        upload,
        media: null,
      });
      continue;
    }

    results.push({
      file_field: item.file_field,
      file_name: fileName,
      skill_id: item.skill_id,
      status: "uploaded",
      reason: null,
      upload,
      media,
    });
  }

  const uploaded = results.filter((item) => item.status === "uploaded").length;
  const skipped = results.filter((item) => item.status === "skipped").length;
  const failed = results.filter((item) => item.status === "failed").length;

  return {
    data: {
      total: results.length,
      uploaded,
      skipped,
      failed,
      items: results,
    },
    error: null,
  };
}

export async function getSkillMediaPlaybackUrl(
  skill_id: string,
  expires_in: number,
): Promise<{ data: SkillMediaPlaybackDto | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { data: row, error } = await client
    .from("skill_media")
    .select("id, skill_id, media_type, url, title, thumbnail_url, sort_order")
    .eq("skill_id", skill_id)
    .eq("media_type", "video")
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) return { data: null, error };
  if (!row) return { data: null, error: new Error("Skill media not found") };

  const media = mapSkillMediaRow(row, SKILLS_MEDIA_BUCKET);
  const rawUrl = typeof row?.url === "string" ? row.url : "";
  if (!rawUrl) {
    return { data: null, error: new Error("Skill media not found") };
  }

  const parsed = parseStorageObjectUrl(rawUrl);
  if (!parsed) {
    return {
      data: {
        media,
        play_url: rawUrl,
        expires_in: null,
      },
      error: null,
    };
  }

  const { data: signed, error: signErr } = await client.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, expires_in);

  if (signErr || !signed?.signedUrl) {
    return { data: null, error: signErr ?? new Error("Failed to create signed URL") };
  }

  return {
    data: {
      media,
      play_url: signed.signedUrl,
      expires_in,
    },
    error: null,
  };
}
