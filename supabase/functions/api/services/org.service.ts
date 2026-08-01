import { sbAdmin } from "./supabase.ts";

export type OrganizationDto = {
  id: string;
  name: string;
  slug: string;
  sport_mode: string | null;
  program_gender: "girls" | "boys" | "coed";
  maxBelowThresholdRatingsAllowed: number | null;
  maxWorkoutReps: number | null;
  sport_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ListOrganizationsFilters = {
  q?: string;
  program_gender?: "girls" | "boys" | "coed";
  sport_id?: string;
  limit: number;
  offset: number;
};

export type UpdateOrganizationInput = {
  name?: string;
  slug?: string;
  sport_mode?: string | null;
  program_gender?: "girls" | "boys" | "coed";
  maxBelowThresholdRatingsAllowed?: number | null;
  maxWorkoutReps?: number | null;
  sport_id?: string | null;
};

const ORG_SELECT =
  "id, name, slug, sport_mode, program_gender, maxBelowThresholdRatingsAllowed, maxWorkoutReps, sport_id, created_at, updated_at";

export async function listOrganizations(filters: ListOrganizationsFilters): Promise<{
  data: OrganizationDto[];
  count: number;
  error: unknown;
}> {
  const client = sbAdmin;
  if (!client) return { data: [], count: 0, error: new Error("Supabase admin client not configured") };

  let query = client
    .from("organizations")
    .select(ORG_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(filters.offset, filters.offset + filters.limit - 1);

  if (filters.q) {
    query = query.or(`name.ilike.%${filters.q}%,slug.ilike.%${filters.q}%`);
  }
  if (filters.program_gender) {
    query = query.eq("program_gender", filters.program_gender);
  }
  if (filters.sport_id) {
    query = query.eq("sport_id", filters.sport_id);
  }

  const { data, count, error } = await query;
  return { data: (data ?? []) as OrganizationDto[], count: count ?? 0, error };
}

export async function getOrganizationById(id: string): Promise<{ data: OrganizationDto | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) return { data: null, error: new Error("Supabase admin client not configured") };

  const { data, error } = await client.from("organizations").select(ORG_SELECT).eq("id", id).maybeSingle();

  return { data: (data ?? null) as OrganizationDto | null, error };
}

export async function updateOrganization(
  id: string,
  input: UpdateOrganizationInput,
): Promise<{ data: OrganizationDto | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) return { data: null, error: new Error("Supabase admin client not configured") };

  const { data, error } = await client
    .from("organizations")
    .update(input)
    .eq("id", id)
    .select(ORG_SELECT)
    .maybeSingle();

  return { data: (data ?? null) as OrganizationDto | null, error };
}
