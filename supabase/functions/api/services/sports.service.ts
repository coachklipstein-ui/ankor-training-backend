import { sbAdmin } from "./supabase.ts";

export type Sport = {
  id: string;
  code: string;
  name: string;
};

export async function listSports(): Promise<{ data: Sport[]; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await client.from("sports").select("id, code, name").order("name", { ascending: true });

  if (error) {
    return { data: [], error };
  }

  return { data: (data ?? []) as Sport[], error: null };
}
