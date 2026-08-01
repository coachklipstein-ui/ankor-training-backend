import { sbAdmin } from "./supabase.ts";
import type {
  SkillDrillMapBySkillListInput,
  SkillDrillMapCreateItem,
  SkillDrillMapListInput,
} from "../dtos/skill_drill_map.dto.ts";

type ServiceResult<T> = {
  data: T | null;
  count?: number;
  error: unknown;
  notFound?: boolean;
  conflict?: boolean;
};

export type SkillDrillMapRow = {
  org_id: string;
  skill_id: string;
  drill_id: string;
  level: number | null;
  created_at: string;
};

async function ensureSkillInOrg(org_id: string, skill_id: string): Promise<{ ok: boolean; error: unknown }> {
  const { data: skill, error: skillError } = await sbAdmin!
    .from("skills")
    .select("id")
    .eq("id", skill_id)
    .eq("org_id", org_id)
    .maybeSingle();

  if (skillError) {
    return { ok: false, error: skillError };
  }

  if (!skill) {
    return { ok: false, error: new Error("Skill not found") };
  }

  return { ok: true, error: null };
}

async function ensureDrillsInOrg(org_id: string, drillIds: string[]): Promise<{ ok: boolean; error: unknown }> {
  const uniqueIds = Array.from(new Set(drillIds));
  if (uniqueIds.length === 0) {
    return { ok: false, error: new Error("At least one drill is required") };
  }

  const { data: drills, error } = await sbAdmin!.from("drills").select("id").eq("org_id", org_id).in("id", uniqueIds);

  if (error) {
    return { ok: false, error };
  }

  const foundIds = new Set((drills ?? []).map((drill) => drill.id));
  const missing = uniqueIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    return { ok: false, error: new Error("One or more drills were not found") };
  }

  return { ok: true, error: null };
}

function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "23505";
}

export async function listSkillDrillMaps(input: SkillDrillMapListInput): Promise<ServiceResult<unknown[]>> {
  if (input.skill_id) {
    const result = await ensureSkillInOrg(input.org_id, input.skill_id);
    if (!result.ok) {
      return {
        data: null,
        count: 0,
        error: result.error,
        notFound: true,
      };
    }
  }

  let query = sbAdmin!
    .from("skill_drill_map")
    .select(
      `
      org_id,
      skill_id,
      drill_id,
      level,
      created_at,
      skill:skills(id, org_id, title, category, level),
      drill:drills(id, org_id, name, level, duration_min)
    `,
      { count: "exact" },
    )
    .eq("org_id", input.org_id)
    .order("created_at", { ascending: false })
    .range(input.offset, input.offset + input.limit - 1);

  if (input.skill_id) {
    query = query.eq("skill_id", input.skill_id);
  }

  if (input.drill_id) {
    query = query.eq("drill_id", input.drill_id);
  }

  const { data, count, error } = await query;
  return { data: data ?? [], count: count ?? 0, error };
}

export async function listSkillDrillMapsBySkill(
  input: SkillDrillMapBySkillListInput & { skill_id: string },
): Promise<ServiceResult<unknown[]>> {
  let query = sbAdmin!
    .from("skill_drill_map")
    .select(
      `
      org_id,
      skill_id,
      drill_id,
      level,
      created_at,
      skill:skills(id, org_id, title, category, level),
      drill:drills(id, org_id, name, level, duration_min)
    `,
      { count: "exact" },
    )
    .eq("skill_id", input.skill_id)
    .order("created_at", { ascending: false })
    .range(input.offset, input.offset + input.limit - 1);

  if (input.drill_id) {
    query = query.eq("drill_id", input.drill_id);
  }

  const { data, count, error } = await query;
  return { data: data ?? [], count: count ?? 0, error };
}

export async function createSkillDrillMaps(args: {
  org_id: string;
  skill_id: string;
  items: SkillDrillMapCreateItem[];
}): Promise<ServiceResult<SkillDrillMapRow[]>> {
  const drillCheck = await ensureDrillsInOrg(
    args.org_id,
    args.items.map((item) => item.drill_id),
  );
  if (!drillCheck.ok) {
    return { data: null, error: drillCheck.error, notFound: true };
  }

  const rows = args.items.map((item) => ({
    org_id: args.org_id,
    skill_id: args.skill_id,
    drill_id: item.drill_id,
    level: item.level,
  }));

  const { data, error } = await sbAdmin!
    .from("skill_drill_map")
    .insert(rows)
    .select("org_id, skill_id, drill_id, level, created_at");

  return {
    data: data ?? null,
    error,
    conflict: isDuplicateKeyError(error),
  };
}

export async function bulkChangeSkillDrillMaps(args: {
  org_id: string;
  skill_id: string;
  addItems: SkillDrillMapCreateItem[];
  removeDrillIds: string[];
}): Promise<
  ServiceResult<{
    added: SkillDrillMapRow[];
    removed: Array<{ skill_id: string; drill_id: string }>;
  }>
> {
  const addDrillIds = args.addItems.map((item) => item.drill_id);
  const removeDrillIds = Array.from(new Set(args.removeDrillIds));
  const drillIds = Array.from(new Set([...addDrillIds, ...removeDrillIds]));

  if (drillIds.length > 0) {
    const drillCheck = await ensureDrillsInOrg(args.org_id, drillIds);
    if (!drillCheck.ok) {
      return { data: null, error: drillCheck.error, notFound: true };
    }
  }

  let added: SkillDrillMapRow[] = [];
  let removed: Array<{ skill_id: string; drill_id: string }> = [];

  if (args.addItems.length > 0) {
    const rows = args.addItems.map((item) => ({
      org_id: args.org_id,
      skill_id: args.skill_id,
      drill_id: item.drill_id,
      level: item.level,
    }));

    const { data, error } = await sbAdmin!
      .from("skill_drill_map")
      .upsert(rows, { onConflict: "skill_id,drill_id" })
      .select("org_id, skill_id, drill_id, level, created_at");

    if (error) {
      return { data: null, error };
    }

    added = data ?? [];
  }

  if (removeDrillIds.length > 0) {
    const { data, error } = await sbAdmin!
      .from("skill_drill_map")
      .delete()
      .eq("org_id", args.org_id)
      .eq("skill_id", args.skill_id)
      .in("drill_id", removeDrillIds)
      .select("skill_id, drill_id");

    if (error) {
      return { data: null, error };
    }

    removed = data ?? [];
  }

  return {
    data: { added, removed },
    error: null,
  };
}

export async function updateSkillDrillMap(args: {
  skill_id: string;
  drill_id: string;
  level: number | null;
}): Promise<ServiceResult<SkillDrillMapRow>> {
  const { data, error } = await sbAdmin!
    .from("skill_drill_map")
    .update({ level: args.level })
    .eq("skill_id", args.skill_id)
    .eq("drill_id", args.drill_id)
    .select("org_id, skill_id, drill_id, level, created_at")
    .maybeSingle();

  return {
    data: data ?? null,
    error,
    notFound: !error && !data,
  };
}

export async function deleteSkillDrillMap(args: {
  org_id: string;
  skill_id: string;
  drill_id: string;
}): Promise<ServiceResult<{ skill_id: string; drill_id: string }>> {
  const skillCheck = await ensureSkillInOrg(args.org_id, args.skill_id);
  if (!skillCheck.ok) {
    return { data: null, error: skillCheck.error, notFound: true };
  }

  const drillCheck = await ensureDrillsInOrg(args.org_id, [args.drill_id]);
  if (!drillCheck.ok) {
    return { data: null, error: drillCheck.error, notFound: true };
  }

  const { data, error } = await sbAdmin!
    .from("skill_drill_map")
    .delete()
    .eq("org_id", args.org_id)
    .eq("skill_id", args.skill_id)
    .eq("drill_id", args.drill_id)
    .select("org_id, skill_id, drill_id")
    .maybeSingle();

  return {
    data: data ?? null,
    error,
    notFound: !error && !data,
  };
}
