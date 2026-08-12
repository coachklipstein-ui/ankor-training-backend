import { sbAdmin } from "./supabase.ts";

export type OrganizationOwnerDto = {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

export type OrganizationDto = {
  id: string;
  name: string;
  slug: string;
  sport_mode: string | null;
  program_gender: "girls" | "boys" | "coed";
  maxBelowThresholdRatingsAllowed: number | null;
  maxWorkoutReps: number | null;
  sport_id: string | null;
  sport_name?: string | null;
  owner?: OrganizationOwnerDto | null;
  teams_count?: number;
  athletes_count?: number;
  coaches_count?: number;
  created_at: string;
  updated_at: string;
};

export type ListOrganizationsFilters = {
  q?: string;
  program_gender?: "girls" | "boys" | "coed";
  sport_id?: string;
  limit: number;
  offset: number;
  adminId: string;
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

const ORG_LIST_SELECT = `
  id,
  name,
  slug,
  sport_mode,
  program_gender,
  maxBelowThresholdRatingsAllowed,
  maxWorkoutReps,
  sport_id,
  sport:sports!organizations_sport_id_fkey(name),
  org_memberships!inner(role, is_active, user_id),
  teams(id, is_active),
  created_at,
  updated_at
`;

export async function listOrganizations(filters: ListOrganizationsFilters): Promise<{
  data: OrganizationDto[];
  count: number;
  error: unknown;
}> {
  const client = sbAdmin;
  if (!client) return { data: [], count: 0, error: new Error("Supabase admin client not configured") };

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("role, default_org_id")
    .eq("user_id", filters.adminId)
    .maybeSingle();

  let query = client
    .from("organizations")
    .select(ORG_LIST_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(filters.offset, filters.offset + filters.limit - 1);

  if (!profileError && typeof profile?.role === "string" && profile.role.trim().toLowerCase() === "admin") {
    const { data: membershipRows, error: membershipError } = await client
      .from("org_memberships")
      .select("org_id")
      .eq("user_id", filters.adminId)
      .eq("role", "admin");

    if (membershipError) {
      return { data: [], count: 0, error: membershipError };
    }

    const orgIds = (membershipRows ?? [])
      .map((row) => (typeof row.org_id === "string" ? row.org_id.trim() : ""))
      .filter((id) => id.length > 0);

    if (orgIds.length === 0) {
      return { data: [], count: 0, error: null };
    }

    query = query.in("id", orgIds);
  }

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

  if (error) {
    return {
      data: [],
      count: 0,
      error,
    };
  }

  const ownerUserIds = [
    ...new Set(
      (data ?? [])
        .flatMap(org =>
          org.org_memberships
            .filter(m => m.role === "owner")
            .map(m => m.user_id)
        )
    ),
  ];

  let ownerProfiles: {
    user_id: string;
    full_name: string | null;
    email: string | null;
  }[] = [];

  if (ownerUserIds.length > 0) {
    const { data, error } = await client
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", ownerUserIds);

    if (error) {
      return {
        data: [],
        count: 0,
        error,
      };
    }

    ownerProfiles = data ?? [];
  }


  const profilesByUserId = new Map(
    ownerProfiles.map(profile => [profile.user_id, profile])
  );
  const organizations = (data ?? []).map(org => {
    const ownerMembership = org.org_memberships.find(
      m => m.role === "owner"
    );

    const owner = ownerMembership
      ? profilesByUserId.get(ownerMembership.user_id) ?? null
      : null;

    return {
      ...org,
      owner,
      coachCount: org.org_memberships.filter(
        m => m.role === "coach" && m.is_active
      ).length,
      athleteCount: org.org_memberships.filter(
        m => m.role === "athlete" && m.is_active
      ).length,
      teamCount: org.teams.filter(
        t => t.is_active
      ).length,
    };
  });

  const items: OrganizationDto[] = organizations.map((row: any) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    sport_mode: row.sport_mode ?? null,
    program_gender: row.program_gender,
    maxBelowThresholdRatingsAllowed:
      row.maxBelowThresholdRatingsAllowed ?? null,
    maxWorkoutReps: row.maxWorkoutReps ?? null,
    sport_id: row.sport_id ?? null,
    sport_name: row.sport?.name ?? null,
    owner: row.owner ?? null,
    teams_count: row.teamCount ?? 0,
    athletes_count: row.athleteCount ?? 0,
    coaches_count: row.coachCount ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  return { data: items, count: count ?? 0, error: null };
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
