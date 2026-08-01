// src/services/teams.service.ts
import { sbAdmin } from "./supabase.ts";
import type { CreateTeamInput, TeamDTO, UpdateTeamInput } from "../dtos/team.dto.ts";

export type TeamAthlete = {
  team_id: string;
  id: string; // athlete id
  org_id: string | null;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  phone: string | null;
  graduation_year: number | null;
  cell_number: string | null;
  position_id: string | null;
  position: string | null;
};

export async function listTeamsWithAthletes(org_id: string): Promise<{
  data: any[] | null;
  error: unknown;
}> {
  const { data, error } = await sbAdmin!
    .from("teams")
    .select(
      `
      id,
      org_id,
      name,
      created_at,
      athletes:athletes (
        id,
        profile:profiles (
          first_name,
          last_name
        )
      )
    `,
    )
    .eq("org_id", org_id)
    .order("created_at", { ascending: false });

  if (error) {
    return { data: null, error };
  }

  // Normalize shape + flatten athlete name fields
  const mapped = (data ?? []).map((row: any) => ({
    id: row.id,
    org_id: row.org_id,
    name: row.name,
    created_at: row.created_at,
    athletes: (row.athletes ?? []).map((a: any) => ({
      id: a.id,
      first_name: a.profile?.first_name ?? null,
      last_name: a.profile?.last_name ?? null,
    })),
  }));

  return { data: mapped, error: null };
}

export async function getAllTeams(): Promise<TeamDTO[]> {
  if (!sbAdmin) {
    throw new Error("Supabase client not initialized");
  }

  const { data, error } = await sbAdmin
    .from("teams")
    .select("id, org_id, sport_id, name, is_active, created_at, updated_at")
    .order("name", { ascending: true });

  if (error) {
    console.error("getAllTeams error:", error);
    throw new Error("Failed to fetch teams");
  }

  return data ?? [];
}

export async function getTeamsByOrgId(orgId: string): Promise<TeamDTO[]> {
  if (!sbAdmin) {
    throw new Error("Supabase client not initialized");
  }

  const { data, error } = await sbAdmin
    .from("teams")
    .select("id, org_id, sport_id, name, is_active, created_at, updated_at")
    .eq("org_id", orgId)
    .order("name", { ascending: true });

  if (error) {
    console.error("getTeamsByOrgId error:", error);
    throw new Error("Failed to fetch teams");
  }

  const mapped = (data ?? []).map((row: any) => ({
    id: row.id,
    org_id: row.org_id,
    sport_id: row.sport_id ?? null,
    name: row.name,
    is_active: row.is_active ?? false,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  }));

  return mapped;
}

export async function getTeamById(team_id: string, org_id: string): Promise<{ data: TeamDTO | null; error: unknown }> {
  if (!sbAdmin) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await sbAdmin
    .from("teams")
    .select("id, org_id, sport_id, name, is_active, created_at, updated_at")
    .eq("id", team_id)
    .eq("org_id", org_id)
    .maybeSingle();

  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };

  return {
    data: {
      id: data.id,
      org_id: data.org_id,
      sport_id: data.sport_id ?? null,
      name: data.name,
      is_active: data.is_active ?? false,
      created_at: data.created_at ?? null,
      updated_at: data.updated_at ?? null,
    },
    error: null,
  };
}

export async function createTeam(input: CreateTeamInput): Promise<{ data: TeamDTO | null; error: unknown }> {
  if (!sbAdmin) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const payload = {
    org_id: input.org_id,
    sport_id: input.sport_id ?? null,
    name: input.name.trim(),
    is_active: input.is_active ?? true,
  };

  const { data, error } = await sbAdmin
    .from("teams")
    .insert(payload)
    .select("id, org_id, sport_id, name, is_active, created_at, updated_at")
    .maybeSingle();

  if (error) return { data: null, error };
  if (!data) return { data: null, error: new Error("Failed to create team") };

  return {
    data: {
      id: data.id,
      org_id: data.org_id,
      sport_id: data.sport_id ?? null,
      name: data.name,
      is_active: data.is_active ?? false,
      created_at: data.created_at ?? null,
      updated_at: data.updated_at ?? null,
    },
    error: null,
  };
}

export async function updateTeam(
  team_id: string,
  org_id: string,
  input: UpdateTeamInput,
): Promise<{ data: TeamDTO | null; error: unknown }> {
  if (!sbAdmin) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.sport_id !== undefined) patch.sport_id = input.sport_id;
  if (input.is_active !== undefined) patch.is_active = input.is_active;

  const { data, error } = await sbAdmin
    .from("teams")
    .update(patch)
    .eq("id", team_id)
    .eq("org_id", org_id)
    .select("id, org_id, sport_id, name, is_active, created_at, updated_at");

  if (error) return { data: null, error };
  if (!data || data.length === 0) {
    return { data: null, error: new Error("Team not found") };
  }

  const row = data[0];
  return {
    data: {
      id: row.id,
      org_id: row.org_id,
      sport_id: row.sport_id ?? null,
      name: row.name,
      is_active: row.is_active ?? false,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
    },
    error: null,
  };
}

export async function deleteTeam(
  team_id: string,
  org_id: string,
): Promise<{ data: { id: string } | null; error: unknown }> {
  if (!sbAdmin) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await sbAdmin.from("teams").delete().eq("id", team_id).eq("org_id", org_id).select("id");

  if (error) return { data: null, error };
  if (!data || data.length === 0) {
    return { data: null, error: new Error("Team not found") };
  }

  return { data: { id: data[0].id }, error: null };
}

export async function getAthletesByTeam(
  teamId: string,
  org_id: string,
): Promise<{ data: TeamAthlete[] | null; error: unknown }> {
  const { data, error } = await sbAdmin!
    .from("team_athletes")
    .select(
      `
      team_id,
      teams!inner(org_id),
      athlete:athletes!inner (
        id,
        org_id,
        user_id,
        first_name,
        last_name,
        full_name,
        phone,
        graduation_year,
        cell_number,
        athlete_positions!inner (
          position_id
        )
      )
    `,
    )
    .eq("team_id", teamId)
    .eq("teams.org_id", org_id)
    .eq("status", "active");

  if (error) {
    return { data: null, error };
  }

  const positionIds = new Set<string>();
  for (const row of data ?? []) {
    const rawPos = (row as any)?.athlete?.athlete_positions;
    const posRow = Array.isArray(rawPos) ? (rawPos[0] ?? null) : (rawPos ?? null);
    const position_id = posRow?.position_id;
    if (typeof position_id === "string" && position_id.trim()) {
      positionIds.add(position_id.trim());
    }
  }

  const positionsById = new Map<string, string | null>();
  if (positionIds.size > 0) {
    const { data: posRows, error: posError } = await sbAdmin!
      .from("positions")
      .select("id, code")
      .in("id", Array.from(positionIds));

    if (posError) {
      return { data: null, error: posError };
    }

    for (const row of posRows ?? []) {
      const id = row?.id;
      if (typeof id !== "string" || !id.trim()) continue;
      positionsById.set(id, row?.code ?? null);
    }
  }

  const mapped: TeamAthlete[] = (data ?? []).map((row: any) => {
    const a = row.athlete ?? {};

    const rawPos = a.athlete_positions;
    const posRow = Array.isArray(rawPos) ? (rawPos[0] ?? null) : (rawPos ?? null);
    const position_id = posRow?.position_id ?? null;
    const position = position_id ? (positionsById.get(position_id) ?? null) : null;

    return {
      team_id: row.team_id,
      id: a.id ?? null,
      org_id: a.org_id ?? null,
      user_id: a.user_id ?? null,
      first_name: a.first_name ?? null,
      last_name: a.last_name ?? null,
      full_name: a.full_name ?? null,
      phone: a.phone ?? null,
      graduation_year: a.graduation_year ?? null,
      cell_number: a.cell_number ?? null,
      position_id,
      position,
    };
  });

  return { data: mapped, error: null };
}
