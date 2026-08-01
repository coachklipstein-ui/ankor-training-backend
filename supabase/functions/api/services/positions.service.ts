import { sbAdmin } from "./supabase.ts";

export type SportPosition = {
  id: string;
  sport_id: string | null;
  code: string;
  name: string;
};

export async function listPositionsByOrgId(org_id: string): Promise<{ data: SportPosition[]; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], error: new Error("Supabase client not initialized") };
  }

  const { data: orgRow, error: orgError } = await client
    .from("organizations")
    .select("sport_id")
    .eq("id", org_id)
    .maybeSingle();

  if (orgError) {
    return { data: [], error: orgError };
  }

  const sportId = orgRow?.sport_id ?? null;
  if (!sportId) {
    return { data: [], error: null };
  }

  const { data, error } = await client
    .from("positions")
    .select("id, sport_id, code, name")
    .eq("sport_id", sportId)
    .order("name", { ascending: true });

  if (error) {
    return { data: [], error };
  }

  return { data: (data ?? []) as SportPosition[], error: null };
}
