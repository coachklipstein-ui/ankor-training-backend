import { sbAdmin } from "./supabase.ts";
import type {
  CreateJoinCodeInput,
  JoinCodeDto,
  JoinCodeListFilterInput,
  UpdateJoinCodeInput,
} from "../dtos/join_codes.dto.ts";

const SELECT_FIELDS =
  "code, org_id, team_id, max_uses, used_count, uses_count, expires_at, is_active, disabled, created_at, updated_at";

function mapJoinCode(row: any): JoinCodeDto {
  return {
    code: row.code,
    org_id: row.org_id,
    team_id: row.team_id ?? null,
    max_uses: row.max_uses ?? 1,
    used_count: row.used_count ?? 0,
    uses_count: row.uses_count ?? 0,
    expires_at: row.expires_at,
    is_active: row.is_active ?? true,
    disabled: row.disabled ?? false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listJoinCodes(
  filters: JoinCodeListFilterInput,
): Promise<{ data: JoinCodeDto[]; count: number; error: unknown }> {
  if (!sbAdmin) {
    return { data: [], count: 0, error: new Error("Supabase client not initialized") };
  }

  const { org_id, team_id, limit, offset } = filters;
  const rangeTo = offset + (limit - 1);

  let query = sbAdmin
    .from("join_codes")
    .select(SELECT_FIELDS, { count: "exact" })
    .eq("org_id", org_id)
    .range(offset, rangeTo)
    .order("created_at", { ascending: false });

  if (team_id) {
    query = query.eq("team_id", team_id);
  }

  const { data, error, count } = await query;
  if (error) return { data: [], count: 0, error };

  const items = (data ?? []).map((row: any) => mapJoinCode(row));
  return { data: items, count: count ?? items.length, error: null };
}

export async function getJoinCodeByCode(
  code: string,
  org_id: string,
): Promise<{ data: JoinCodeDto | null; error: unknown }> {
  if (!sbAdmin) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await sbAdmin
    .from("join_codes")
    .select(SELECT_FIELDS)
    .eq("code", code)
    .eq("org_id", org_id)
    .maybeSingle();

  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };

  return { data: mapJoinCode(data), error: null };
}

export async function createJoinCode(
  input: CreateJoinCodeInput,
): Promise<{ data: JoinCodeDto | null; error: unknown }> {
  if (!sbAdmin) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const code = crypto.randomUUID();
  const payload = {
    code,
    org_id: input.org_id,
    team_id: input.team_id ?? null,
    max_uses: input.max_uses ?? 1,
    expires_at: input.expires_at,
    is_active: input.is_active ?? true,
    disabled: input.disabled ?? false,
  };

  const { data, error } = await sbAdmin.from("join_codes").insert(payload).select(SELECT_FIELDS).maybeSingle();

  if (error) return { data: null, error };
  if (!data) return { data: null, error: new Error("Failed to create join code") };

  return { data: mapJoinCode(data), error: null };
}

export async function updateJoinCode(
  code: string,
  org_id: string,
  input: UpdateJoinCodeInput,
): Promise<{ data: JoinCodeDto | null; error: unknown }> {
  if (!sbAdmin) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const patch: Record<string, unknown> = {};
  if (input.team_id !== undefined) patch.team_id = input.team_id;
  if (input.max_uses !== undefined) patch.max_uses = input.max_uses;
  if (input.expires_at !== undefined) patch.expires_at = input.expires_at;
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  if (input.disabled !== undefined) patch.disabled = input.disabled;

  const { data, error } = await sbAdmin
    .from("join_codes")
    .update(patch)
    .eq("code", code)
    .eq("org_id", org_id)
    .select(SELECT_FIELDS);

  if (error) return { data: null, error };
  if (!data || data.length === 0) {
    return { data: null, error: new Error("Join code not found") };
  }

  return { data: mapJoinCode(data[0]), error: null };
}

export async function deleteJoinCode(
  code: string,
  org_id: string,
): Promise<{ data: { code: string } | null; error: unknown }> {
  if (!sbAdmin) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await sbAdmin
    .from("join_codes")
    .delete()
    .eq("code", code)
    .eq("org_id", org_id)
    .select("code");

  if (error) return { data: null, error };
  if (!data || data.length === 0) {
    return { data: null, error: new Error("Join code not found") };
  }

  return { data: { code: data[0].code }, error: null };
}
