import { sbAdmin } from "./supabase.ts";
import {
  type CreateDrillDto,
  type CreateDrillMediaInput,
  type DrillDto,
  type DrillListFilterInput,
  type DrillMediaBatchInput,
  type DrillMediaBatchItemResult,
  type DrillMediaBatchResult,
  type DrillMediaDto,
  type DrillMediaPlaybackDto,
  type DrillMediaRecordDto,
  type DrillMediaUploadInput,
  type DrillMediaUploadResult,
  type DrillSegmentDto,
  type DrillTagDto,
  type RpcCreateDrillPayload,
  type UpdateDrillInput,
} from "../dtos/drills.dto.ts";
import { DRILLS_MEDIA_BUCKET } from "../config/env.ts";

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

function buildDrillMediaPath(input: {
  org_id: string;
  drill_id: string;
  file_name: string;
  content_type: string;
}): string {
  const safeName = sanitizeFileName(input.file_name);
  const extension = inferExtension(safeName, input.content_type);
  const fileId = crypto.randomUUID();
  return `orgs/${input.org_id}/drills/${input.drill_id}/${fileId}${extension}`;
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

  const name = (file.name ?? "").trim().toLowerCase();
  if (name.endsWith(".mp4")) return "video/mp4";

  return null;
}

async function removeDrillMediaObject(bucket: string, objectPath: string): Promise<void> {
  const client = sbAdmin;
  if (!client) return;

  await client.storage.from(bucket).remove([objectPath]);
}

async function removeOtherDrillVideoMedia(
  drill_id: string,
  keepMediaId: string,
  keepUrl: string,
): Promise<{ error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { error: new Error("Supabase client not initialized") };
  }

  const { data: removedRows, error } = await client
    .from("drill_media")
    .delete()
    .eq("drill_id", drill_id)
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

    await removeDrillMediaObject(parsed.bucket, parsed.path).catch((err) => {
      console.error("[removeOtherDrillVideoMedia] failed to remove storage object", err);
    });
  }

  return { error: null };
}

type DrillMediaBatchUploadItem = DrillMediaBatchInput["items"][number] & {
  file: File;
};

async function ensureDrillOrg(drill_id: string, org_id: string): Promise<{ error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await client
    .from("drills")
    .select("id")
    .eq("id", drill_id)
    .eq("org_id", org_id)
    .maybeSingle();

  if (error) {
    return { error };
  }

  if (!data) {
    return { error: new Error("Drill not found") };
  }

  return { error: null };
}

export async function createDrillMediaUploadUrl(
  input: DrillMediaUploadInput,
): Promise<{ data: DrillMediaUploadResult | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const path = buildDrillMediaPath(input);
  const bucket = DRILLS_MEDIA_BUCKET;

  const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(path);

  if (error || !data?.signedUrl || !data.token) {
    return { data: null, error: error ?? new Error("Failed to create upload URL") };
  }

  const publicResult = client.storage.from(bucket).getPublicUrl(path);
  const public_url = publicResult.data?.publicUrl ?? "";

  return {
    data: {
      bucket,
      path,
      signed_url: data.signedUrl,
      token: data.token,
      public_url,
    },
    error: null,
  };
}

export async function getDrillMediaPlaybackUrl(
  drill_id: string,
  expires_in: number,
): Promise<{ data: DrillMediaPlaybackDto | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { data: row, error } = await client
    .from("drill_media")
    .select("id, drill_id, media_type, url, title, thumbnail_url, sort_order")
    .eq("drill_id", drill_id)
    .eq("media_type", "video")
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { data: null, error };
  }

  if (!row) {
    return { data: null, error: new Error("Drill media not found") };
  }

  const media = mapDrillMediaRow(row);
  const storageRef = parseStorageObjectUrl(media.url);

  if (!storageRef) {
    return {
      data: {
        media,
        play_url: media.url,
        expires_in: null,
      },
      error: null,
    };
  }

  const { data: signed, error: signErr } = await client.storage
    .from(storageRef.bucket)
    .createSignedUrl(storageRef.path, expires_in);

  if (signErr || !signed?.signedUrl) {
    return {
      data: null,
      error: signErr ?? new Error("Failed to create signed URL"),
    };
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

export async function createDrillMedia(
  input: CreateDrillMediaInput,
): Promise<{ data: DrillMediaRecordDto | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { drill_id, org_id, type, url, title, description, thumbnail_url } = input;
  let position = input.position ?? null;

  const { error: drillError } = await ensureDrillOrg(drill_id, org_id);
  if (drillError) {
    return { data: null, error: drillError };
  }

  if (position === null || position === undefined) {
    const { data: lastRow, error: lastError } = await client
      .from("drill_media")
      .select("sort_order")
      .eq("drill_id", drill_id)
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
    .from("drill_media")
    .insert({
      drill_id,
      media_type: type,
      url,
      title: title ?? null,
      thumbnail_url: thumbnail_url ?? null,
      sort_order: position ?? null,
    })
    .select("id, drill_id, media_type, url, title,thumbnail_url,sort_order")
    .single();

  if (error) {
    return { data: null, error };
  }

  if (type === "video") {
    const { error: replaceError } = await removeOtherDrillVideoMedia(drill_id, data.id, url);

    if (replaceError) {
      return { data: null, error: replaceError };
    }
  }

  return { data: mapDrillMediaRow(data), error: null };
}

export async function uploadDrillMediaBatch(input: {
  org_id: string;
  items: DrillMediaBatchUploadItem[];
}): Promise<{ data: DrillMediaBatchResult | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const results: DrillMediaBatchItemResult[] = [];

  for (const item of input.items) {
    const fileName = sanitizeFileName(item.file.name || `${item.file_field}.mp4`);
    const contentType = resolveBatchVideoContentType(item.file);

    if (!contentType) {
      results.push({
        file_field: item.file_field,
        file_name: fileName,
        drill_id: item.drill_id,
        status: "failed",
        reason: "Only .mp4 videos are supported",
        upload: null,
        media: null,
      });
      continue;
    }

    const { data: upload, error: uploadUrlError } = await createDrillMediaUploadUrl({
      org_id: input.org_id,
      drill_id: item.drill_id,
      file_name: fileName,
      content_type: contentType,
      type: "video",
      title: item.title,
      description: item.description,
      thumbnail_url: item.thumbnail_url,
      position: item.position,
    });

    if (uploadUrlError || !upload) {
      results.push({
        file_field: item.file_field,
        file_name: fileName,
        drill_id: item.drill_id,
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
      .uploadToSignedUrl(upload.path, upload.token, item.file, {
        contentType,
      });

    if (storageError) {
      results.push({
        file_field: item.file_field,
        file_name: fileName,
        drill_id: item.drill_id,
        status: "failed",
        reason: getErrorMessage(storageError),
        upload,
        media: null,
      });
      continue;
    } else {
      uploadedToStorage = true;
    }

    const { data: media, error: mediaError } = await createDrillMedia({
      org_id: input.org_id,
      drill_id: item.drill_id,
      type: "video",
      url: upload.public_url,
      title: item.title,
      description: item.description,
      thumbnail_url: item.thumbnail_url,
      position: item.position,
    });

    if (mediaError || !media) {
      if (uploadedToStorage) {
        await removeDrillMediaObject(upload.bucket, upload.path);
      }
      results.push({
        file_field: item.file_field,
        file_name: fileName,
        drill_id: item.drill_id,
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
      drill_id: item.drill_id,
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

export async function createDrill(dto: CreateDrillDto): Promise<{
  data: unknown;
  error: unknown;
}> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { data: orgRow, error: orgError } = await client
    .from("organizations")
    .select("sport_id")
    .eq("id", dto.org_id)
    .maybeSingle();

  if (orgError) {
    return { data: null, error: orgError };
  }

  if (!orgRow) {
    return { data: null, error: new Error("Organization not found") };
  }

  if (!orgRow.sport_id) {
    return { data: null, error: new Error("Organization does not have a sport_id") };
  }

  const payload: RpcCreateDrillPayload = {
    p_drill: {
      org_id: dto.org_id,
      segment_id: dto.segment_id ?? null,
      sport_id: orgRow.sport_id,
      name: dto.name.trim(),
      description: dto.description ?? null,
      instructions: dto.instructions ?? null,
      level: dto.level ?? null,
      min_age: dto.min_age ?? null,
      max_age: dto.max_age ?? null,
      duration_seconds: dto.duration_seconds ?? null,
      created_by: dto.created_by ?? null,
    },
    p_media: (dto.media ?? []).map((item) => ({
      type: item.type,
      url: item.url,
      title: item.title ?? null,
      description: item.description ?? null,
      thumbnail_url: item.thumbnail_url ?? null,
      position: item.position ?? null,
    })),
    p_skill_tags: (dto.skill_tags ?? []).map((tag) => tag.skill_id),
  };

  const { data, error } = await client.rpc("rpc_create_drill", payload);

  if (error) {
    return { data: null, error };
  }

  return { data: data ?? null, error: null };
}

export async function updateDrill(
  drill_id: string,
  input: UpdateDrillInput,
): Promise<{ data: unknown; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.instructions !== undefined) patch.coaching_points = input.instructions;
  if (input.level !== undefined) patch.level = input.level;
  if (input.segment_id !== undefined) patch.segment_id = input.segment_id;
  if (input.min_age !== undefined) patch.min_age = input.min_age;
  if (input.max_age !== undefined) patch.max_age = input.max_age;
  if (input.min_players !== undefined) patch.min_players = input.min_players;
  if (input.max_players !== undefined) patch.max_players = input.max_players;
  if (input.visibility !== undefined) patch.visibility = input.visibility;
  if (input.is_archived !== undefined) patch.is_archived = input.is_archived;

  if (input.duration_min !== undefined) {
    patch.duration_min = input.duration_min;
  } else if (input.duration_seconds !== undefined) {
    patch.duration_min = input.duration_seconds === null ? null : Math.ceil(input.duration_seconds / 60);
  }

  if (Object.keys(patch).length > 0) {
    const { data, error } = await client.from("drills").update(patch).eq("id", drill_id).select("id");

    if (error) {
      return { data: null, error };
    }

    if (!data || data.length === 0) {
      return { data: null, error: new Error("Drill not found") };
    }
  } else {
    const { data, error } = await client.from("drills").select("id").eq("id", drill_id);

    if (error) {
      return { data: null, error };
    }

    if (!data || data.length === 0) {
      return { data: null, error: new Error("Drill not found") };
    }
  }

  const addTagIds = Array.from(new Set(input.add_tag_ids ?? []));
  const removeTagIds = Array.from(new Set(input.remove_tag_ids ?? []));
  const removeSet = removeTagIds.filter((id) => !addTagIds.includes(id));

  if (addTagIds.length > 0) {
    const { data: tags, error } = await client.from("drill_tags").select("id").in("id", addTagIds);

    if (error) {
      return { data: null, error };
    }

    const foundTagIds = new Set((tags ?? []).map((tag: { id: string }) => tag.id));
    if (addTagIds.some((id) => !foundTagIds.has(id))) {
      return {
        data: null,
        error: new Error("Invalid drill tags"),
      };
    }
  }

  if (removeSet.length > 0) {
    const { error } = await client.from("drill_tag_map").delete().eq("drill_id", drill_id).in("tag_id", removeSet);

    if (error) {
      return { data: null, error };
    }
  }

  if (addTagIds.length > 0) {
    const rows = addTagIds.map((tag_id) => ({ drill_id, tag_id }));
    const { error } = await client.from("drill_tag_map").upsert(rows, { onConflict: "drill_id,tag_id" });

    if (error) {
      return { data: null, error };
    }
  }

  const { data, error } = await getDrillById(drill_id);
  if (error) {
    return { data: null, error };
  }

  return { data, error: null };
}

export async function listSegments(): Promise<{
  data: DrillSegmentDto[];
  error: unknown;
}> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await client.from("segments").select("id, name").order("name", { ascending: true });

  if (error) {
    return { data: [], error };
  }

  const segments: DrillSegmentDto[] = (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name ?? null,
  }));

  return { data: segments, error: null };
}

export async function listDrillTags(params: {
  org_id: string;
  sport_id?: string;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<{ data: DrillTagDto[]; count: number; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], count: 0, error: new Error("Supabase client not initialized") };
  }

  const { org_id, sport_id, q, limit = 50, offset = 0 } = params;

  let query = client
    .from("drill_tags")
    .select("id, name ")
    .eq("org_id", org_id)
    .order("name", { ascending: true })
    .range(offset, offset + (limit - 1));

  if (sport_id) {
    query = query.eq("sport_id", sport_id);
  }

  if (q?.trim()) {
    query = query.or(`name.ilike.%${q}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    return { data: [], count: 0, error };
  }

  const tags: DrillTagDto[] = (data ?? []).map((row: any) => ({
    id: row.id,
    name: typeof row.name === "string" ? row.name : "",
  }));

  return { data: tags, count: count ?? tags.length, error: null };
}

export async function listDrills(
  filters: DrillListFilterInput,
): Promise<{ data: DrillDto[]; count: number; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], count: 0, error: new Error("Supabase client not initialized") };
  }

  const {
    org_id,
    name,
    levels,
    segment_ids,
    min_age,
    max_age,
    min_players,
    max_players,
    skill_tag_ids,
    limit,
    offset,
  } = filters;

  const rangeTo = offset + (limit - 1);

  const { data: orgRow, error: orgError } = await client
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

  console.log(`SPORT ID = ${sportId}`);
  console.log(`ORG ID ${org_id}`);

  // IMPORTANT:
  // - If filtering by tags, embed drill_tag_map with !inner so drills are filtered.
  // - If not filtering by tags, don't use !inner or you’ll exclude drills with no tags.
  const tagEmbed =
    (skill_tag_ids?.length ?? 0) > 0
      ? "drill_tag_map!inner(tag_id, drill_tags!inner(id, name))"
      : "drill_tag_map(tag_id, drill_tags!inner(id, name))";

  let query = client
    .from("drills")
    .select(
      `
        id,
        org_id,
        segment_id,
        name,
        description,
        level,
        min_players,
        max_players,
        min_age,
        max_age,
        duration_min,
        visibility,
        is_archived,
        created_at,
        updated_at,
        segment:segments(id, name),
        drill_media(id, media_type, title, url, thumbnail_url, sort_order),
        ${tagEmbed}
      `,
      { count: "exact" },
    )
    .eq("sport_id", sportId)
    .range(offset, rangeTo)
    .order("created_at", { ascending: false });

  if (name) query = query.ilike("name", `%${name}%`);
  if (segment_ids?.length) query = query.in("segment_id", segment_ids);
  if (levels?.length) query = query.in("level", levels);

  if (min_age !== null && min_age !== undefined) query = query.gte("min_age", min_age);
  if (max_age !== null && max_age !== undefined) query = query.lte("max_age", max_age);

  if (min_players !== null && min_players !== undefined) query = query.gte("min_players", min_players);
  if (max_players !== null && max_players !== undefined) query = query.lte("max_players", max_players);

  if (skill_tag_ids?.length) {
    query = query.in("drill_tag_map.tag_id", skill_tag_ids);
  }

  console.log(`SKILL TAG IDS = ${skill_tag_ids?.join(",")}`);

  const { data, error, count } = await query;

  if (error) return { data: [], count: 0, error };

  const mapped: DrillDto[] = (data ?? []).map((row: any) => mapDrillRowToDto(row));
  return { data: mapped, count: count ?? mapped.length, error: null };
}

function mapDrillRowToDto(row: any): DrillDto {
  const media: DrillMediaDto[] = (row.drill_media ?? []).map((m: any) => ({
    type: m.media_type ?? "video",
    url: m.url,
    title: m.title ?? null,
    description: null,
    thumbnail_url: m.thumbnail_url ?? null,
    position: m.sort_order ?? null,
  }));

  const skill_tags: { id: string; name: string }[] = (row.drill_tag_map ?? [])
    .map((item: any) => {
      const tag = item?.drill_tags ?? null;
      if (!tag?.id) return null;
      return {
        id: tag.id,
        name: typeof tag.name === "string" ? tag.name : "",
      };
    })
    .filter((tag: { id: string; name: string } | null): tag is { id: string; name: string } => Boolean(tag));

  return {
    id: row.id,
    org_id: row.org_id ?? null,
    segment_id: row.segment_id ?? null,
    name: row.name,
    description: row.description ?? null,
    level: row.level ?? null,
    min_players: row.min_players ?? null,
    max_players: row.max_players ?? null,
    min_age: row.min_age ?? null,
    max_age: row.max_age ?? null,
    duration_min: row.duration_min ?? null,
    visibility: row.visibility ?? null,
    is_archived: row.is_archived ?? false,
    created_at: row.created_at,
    updated_at: row.updated_at,
    segment: row.segment ? { id: row.segment.id, name: row.segment.name ?? null } : null,
    skill_tags,
    media,
  };
}

function mapDrillMediaRow(row: any): DrillMediaRecordDto {
  return {
    id: row.id,
    drill_id: row.drill_id,
    type: row.media_type ?? "video",
    url: row.url,
    title: row.title ?? null,
    thumbnail_url: row.thumbnail_url ?? null,
    position: row.sort_order ?? null,
  };
}

export async function getDrillById(
  drill_id: string,
  org_id?: string,
): Promise<{
  data: DrillDto | null;
  error: unknown;
}> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  let sportId: string | null = null;
  if (org_id) {
    const { data: orgRow, error: orgError } = await client
      .from("organizations")
      .select("sport_id")
      .eq("id", org_id)
      .maybeSingle();

    if (orgError) {
      return { data: null, error: orgError };
    }

    sportId = orgRow?.sport_id ?? null;
    if (!sportId) {
      return { data: null, error: null };
    }
  }

  let query = client
    .from("drills")
    .select(
      `
      id,
      org_id,
      segment_id,
      name,
      description,
      level,
      min_players,
      max_players,
      min_age,
      max_age,
      duration_min,
      visibility,
      is_archived,
      created_at,
      updated_at
    `,
    )
    .eq("id", drill_id);

  if (sportId) {
    query = query.eq("sport_id", sportId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    return { data: null, error };
  }

  if (!data) {
    return { data: null, error: null };
  }

  const [segmentResult, mediaResult, tagMapResult] = await Promise.all([
    data.segment_id
      ? client.from("segments").select("id, name").eq("id", data.segment_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    client
      .from("drill_media")
      .select("id, drill_id, media_type, title, url, thumbnail_url, sort_order")
      .eq("drill_id", drill_id)
      .order("sort_order", { ascending: true }),
    client.from("drill_tag_map").select("tag_id").eq("drill_id", drill_id),
  ]);

  if (segmentResult.error) return { data: null, error: segmentResult.error };
  if (mediaResult.error) return { data: null, error: mediaResult.error };
  if (tagMapResult.error) return { data: null, error: tagMapResult.error };

  const tagIds = (tagMapResult.data ?? []).map((item: { tag_id: string }) => item.tag_id);
  const tagRowsResult =
    tagIds.length > 0 ? await client.from("drill_tags").select("id, name").in("id", tagIds) : { data: [], error: null };

  if (tagRowsResult.error) return { data: null, error: tagRowsResult.error };
  const tagsById = new Map((tagRowsResult.data ?? []).map((tag: { id: string; name: string | null }) => [tag.id, tag]));

  return {
    data: mapDrillRowToDto({
      ...data,
      segment: segmentResult.data,
      drill_media: mediaResult.data ?? [],
      drill_tag_map: tagIds
        .map((tag_id: string) => ({ tag_id, drill_tags: tagsById.get(tag_id) }))
        .filter((item: { drill_tags?: { id: string; name: string | null } }) => Boolean(item.drill_tags)),
    }),
    error: null,
  };
}
