import { sbAdmin } from "./supabase.ts";

const MANAGED_ORG_ROLES = ["owner", "admin", "coach", "athlete", "parent", "staff", "viewer"] as const;

export type ManagedOrgRole = (typeof MANAGED_ORG_ROLES)[number];

export type OrgUserDto = {
  user_id: string;
  role: "athlete" | "coach";
  full_name: string | null;
  phone: string | null;
  graduation_year: number | null;
};

export type ManagedUserDto = {
  user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  phone: string | null;
  profile_role: string | null;
  org_id: string | null;
  org_role: ManagedOrgRole | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

export type CreateManagedUserInput = {
  org_id: string;
  email: string;
  password: string;
  role: ManagedOrgRole;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  phone?: string | null;
  email_confirm?: boolean;
};

export type UpdateManagedUserInput = {
  org_id?: string | null;
  email?: string | null;
  password?: string | null;
  role?: ManagedOrgRole | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  phone?: string | null;
  is_active?: boolean | null;
};

export function isManagedOrgRole(value: string): value is ManagedOrgRole {
  return MANAGED_ORG_ROLES.includes(value as ManagedOrgRole);
}

function mapPhone(row: any): string | null {
  return row?.cell_number ?? row?.phone ?? null;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

function buildFullName(input: {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
}): string | null {
  const explicit = normalizeText(input.full_name);
  if (explicit) return explicit;
  return normalizeText([normalizeText(input.first_name), normalizeText(input.last_name)].filter(Boolean).join(" "));
}

function mapManagedUserRow(
  row: any,
  orgId: string | null,
  profilesByUserId: Map<string, any> = new Map(),
): ManagedUserDto {
  const profile = profilesByUserId.get(row.user_id) ?? row.profile ?? null;
  return {
    user_id: row.user_id,
    email: profile?.email ?? null,
    first_name: profile?.first_name ?? null,
    last_name: profile?.last_name ?? null,
    full_name: profile?.full_name ?? null,
    phone: profile?.phone ?? null,
    profile_role: profile?.role ?? null,
    org_id: row.org_id ?? orgId,
    org_role: row.role ?? null,
    is_active: row.is_active ?? null,
    created_at: profile?.created_at ?? null,
    updated_at: profile?.updated_at ?? null,
  };
}

export async function listOrgUsers(org_id: string): Promise<{ data: OrgUserDto[]; count: number; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], count: 0, error: new Error("Supabase client not initialized") };
  }

  const [athletesResult, coachesResult] = await Promise.all([
    client.from("athletes").select("user_id, full_name, cell_number, graduation_year").eq("org_id", org_id),
    client.from("coaches").select("user_id, full_name, cell_number").eq("org_id", org_id),
  ]);

  if (athletesResult.error) {
    return { data: [], count: 0, error: athletesResult.error };
  }
  if (coachesResult.error) {
    return { data: [], count: 0, error: coachesResult.error };
  }

  const athletes: OrgUserDto[] = (athletesResult.data ?? [])
    .filter((row: any) => row?.user_id)
    .map((row: any) => ({
      user_id: row.user_id,
      role: "athlete",
      full_name: row.full_name ?? null,
      phone: mapPhone(row),
      graduation_year: row.graduation_year ?? null,
    }));

  const coaches: OrgUserDto[] = (coachesResult.data ?? [])
    .filter((row: any) => row?.user_id)
    .map((row: any) => ({
      user_id: row.user_id,
      role: "coach",
      full_name: row.full_name ?? null,
      phone: mapPhone(row),
      graduation_year: null,
    }));

  const items = [...athletes, ...coaches].sort((a, b) => {
    const last = (a.full_name ?? "").localeCompare(b.full_name ?? "");
    if (last !== 0) return last;
    return (a.user_id ?? "").localeCompare(b.user_id ?? "");
  });

  return { data: items, count: items.length, error: null };
}

export async function listManagedUsers(
  org_id: string,
): Promise<{ data: ManagedUserDto[]; count: number; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], count: 0, error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await client
    .from("org_memberships")
    .select("org_id, user_id, role, is_active")
    .eq("org_id", org_id)
    .order("role", { ascending: true });

  if (error) return { data: [], count: 0, error };

  const userIds = (data ?? [])
    .map((row: any) => row?.user_id)
    .filter((value: unknown): value is string => typeof value === "string" && value.length > 0);

  const profilesByUserId = new Map<string, any>();
  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await client
      .from("profiles")
      .select("user_id, email, first_name, last_name, full_name, phone, role, created_at, updated_at")
      .in("user_id", userIds);

    if (profilesError) return { data: [], count: 0, error: profilesError };
    for (const profile of profiles ?? []) {
      if (profile?.user_id) profilesByUserId.set(profile.user_id, profile);
    }
  }

  const items = (data ?? []).map((row: any) => mapManagedUserRow(row, org_id, profilesByUserId));
  items.sort((a, b) => {
    const byName = (a.full_name ?? "").localeCompare(b.full_name ?? "");
    if (byName !== 0) return byName;
    return (a.email ?? "").localeCompare(b.email ?? "");
  });

  return { data: items, count: items.length, error: null };
}

export async function getManagedUser(
  user_id: string,
  org_id?: string | null,
): Promise<{ data: ManagedUserDto | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) return { data: null, error: new Error("Supabase client not initialized") };

  let membershipQuery = client
    .from("org_memberships")
    .select("org_id, user_id, role, is_active")
    .eq("user_id", user_id)
    .limit(1);

  if (org_id) membershipQuery = membershipQuery.eq("org_id", org_id);

  const { data: memberships, error: membershipError } = await membershipQuery;
  if (membershipError) return { data: null, error: membershipError };

  const membership = memberships?.[0] ?? null;
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("email, first_name, last_name, full_name, phone, role, created_at, updated_at")
    .eq("user_id", user_id)
    .maybeSingle();

  if (profileError) return { data: null, error: profileError };

  if (!membership && !profile) return { data: null, error: null };

  return {
    data: {
      user_id,
      email: profile?.email ?? null,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      full_name: profile?.full_name ?? null,
      phone: profile?.phone ?? null,
      profile_role: profile?.role ?? null,
      org_id: membership?.org_id ?? org_id ?? null,
      org_role: membership?.role ?? null,
      is_active: membership?.is_active ?? null,
      created_at: profile?.created_at ?? null,
      updated_at: profile?.updated_at ?? null,
    },
    error: null,
  };
}

export async function createManagedUser(
  input: CreateManagedUserInput,
): Promise<{ data: ManagedUserDto | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) return { data: null, error: new Error("Supabase client not initialized") };

  const email = normalizeEmail(input.email);
  const firstName = normalizeText(input.first_name);
  const lastName = normalizeText(input.last_name);
  const fullName = buildFullName(input);
  const phone = normalizeText(input.phone);

  const { data: created, error: createError } = await client.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: input.email_confirm ?? true,
    user_metadata: {
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      phone,
    },
    app_metadata: { role: input.role },
  });

  if (createError) return { data: null, error: createError };

  const userId = created.user?.id ?? null;
  if (!userId) return { data: null, error: new Error("User was not returned by Supabase") };

  const profilePayload = {
    id: userId,
    user_id: userId,
    email,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    phone,
    default_org_id: input.org_id,
    role: input.role,
  };

  const { error: profileError } = await client.from("profiles").upsert(profilePayload, { onConflict: "id" });

  if (profileError) {
    try {
      await client.auth.admin.deleteUser(userId);
    } catch {
      // ignore cleanup failure
    }
    return { data: null, error: profileError };
  }

  try {
    await client.from("users").upsert({
      id: userId,
      email,
      full_name: fullName,
    });
  } catch {
    // best-effort legacy table sync
  }

  const { error: membershipError } = await client.from("org_memberships").upsert(
    {
      org_id: input.org_id,
      user_id: userId,
      role: input.role,
      is_active: true,
    },
    { onConflict: "org_id,user_id" },
  );

  if (membershipError) {
    try {
      await client.auth.admin.deleteUser(userId);
    } catch {
      // ignore cleanup failure
    }
    return { data: null, error: membershipError };
  }

  return await getManagedUser(userId, input.org_id);
}

export async function updateManagedUser(
  user_id: string,
  input: UpdateManagedUserInput,
): Promise<{ data: ManagedUserDto | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) return { data: null, error: new Error("Supabase client not initialized") };

  const authUpdates: Record<string, unknown> = {};
  const email = input.email ? normalizeEmail(input.email) : null;
  if (email) authUpdates.email = email;
  if (input.password) authUpdates.password = input.password;

  const fullName = buildFullName(input);
  if (
    input.first_name !== undefined ||
    input.last_name !== undefined ||
    input.full_name !== undefined ||
    input.phone !== undefined
  ) {
    authUpdates.user_metadata = {
      first_name: normalizeText(input.first_name),
      last_name: normalizeText(input.last_name),
      full_name: fullName,
      phone: normalizeText(input.phone),
    };
  }
  if (input.role) authUpdates.app_metadata = { role: input.role };

  if (Object.keys(authUpdates).length > 0) {
    const { error } = await client.auth.admin.updateUserById(user_id, authUpdates);
    if (error) return { data: null, error };
  }

  const profileUpdates: Record<string, unknown> = {};
  if (email) profileUpdates.email = email;
  if (input.first_name !== undefined) profileUpdates.first_name = normalizeText(input.first_name);
  if (input.last_name !== undefined) profileUpdates.last_name = normalizeText(input.last_name);
  if (input.full_name !== undefined || input.first_name !== undefined || input.last_name !== undefined) {
    profileUpdates.full_name = fullName;
  }
  if (input.phone !== undefined) profileUpdates.phone = normalizeText(input.phone);
  if (input.role) profileUpdates.role = input.role;
  if (input.org_id) profileUpdates.default_org_id = input.org_id;

  if (Object.keys(profileUpdates).length > 0) {
    const { error } = await client.from("profiles").update(profileUpdates).eq("user_id", user_id);
    if (error) return { data: null, error };
  }

  if (email || fullName !== null) {
    const userUpdates: Record<string, unknown> = {};
    if (email) userUpdates.email = email;
    if (fullName !== null) userUpdates.full_name = fullName;
    try {
      await client.from("users").update(userUpdates).eq("id", user_id);
    } catch {
      // best-effort legacy table sync
    }
  }

  if (input.org_id && (input.role || input.is_active !== undefined)) {
    const membershipPayload: Record<string, unknown> = {
      org_id: input.org_id,
      user_id,
    };
    if (input.role) membershipPayload.role = input.role;
    if (input.is_active !== undefined) membershipPayload.is_active = input.is_active ?? true;

    const { error } = await client.from("org_memberships").upsert(membershipPayload, { onConflict: "org_id,user_id" });
    if (error) return { data: null, error };
  }

  return await getManagedUser(user_id, input.org_id ?? null);
}

export async function deleteManagedUser(
  user_id: string,
  org_id: string,
  hardDelete = false,
): Promise<{ data: { user_id: string; deleted: boolean; deactivated: boolean }; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return {
      data: { user_id, deleted: false, deactivated: false },
      error: new Error("Supabase client not initialized"),
    };
  }

  if (!hardDelete) {
    const { error } = await client
      .from("org_memberships")
      .update({ is_active: false })
      .eq("org_id", org_id)
      .eq("user_id", user_id);
    if (error) return { data: { user_id, deleted: false, deactivated: false }, error };
    return { data: { user_id, deleted: false, deactivated: true }, error: null };
  }

  const { error } = await client.auth.admin.deleteUser(user_id);
  if (error) return { data: { user_id, deleted: false, deactivated: false }, error };

  try {
    await client.from("org_memberships").delete().eq("user_id", user_id);
    await client.from("profiles").delete().eq("user_id", user_id);
    await client.from("users").delete().eq("id", user_id);
  } catch {
    // auth deletion above is the authoritative hard delete
  }

  return { data: { user_id, deleted: true, deactivated: false }, error: null };
}
