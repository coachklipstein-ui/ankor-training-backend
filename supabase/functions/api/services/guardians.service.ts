import { sbAdmin } from "./supabase.ts";
import { generateMagicLink, sendWelcomeEmail } from "./email.service.ts";
import type {
  CreateGuardianInput,
  GuardianDto,
  GuardianListFilterInput,
  UpdateGuardianInput,
} from "../dtos/guardians.dto.ts";

function mapGuardianRow(row: any): GuardianDto {
  const links = Array.isArray(row.athlete_guardians)
    ? row.athlete_guardians
    : row.athlete_guardians
      ? [row.athlete_guardians]
      : [];

  const athletes = links
    .map((link: any) => ({
      athlete_id: typeof link?.athlete_id === "string" ? link.athlete_id : null,
      relationship: link?.relationship ?? null,
    }))
    .filter((link: { athlete_id: string | null }) => Boolean(link.athlete_id)) as {
    athlete_id: string;
    relationship: string | null;
  }[];

  return {
    id: row.id,
    org_id: row.org_id ?? null,
    user_id: row.user_id ?? null,
    full_name: row.full_name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    address_line1: row.address_line1 ?? null,
    address_line2: row.address_line2 ?? null,
    city: row.city ?? null,
    region: row.region ?? null,
    postal_code: row.postal_code ?? null,
    country: row.country ?? null,
    athletes,
  };
}

async function findUserIdByEmail(client: any, email: string): Promise<{ userId: string | null; error: unknown }> {
  const admin = client?.auth?.admin;
  if (!admin) {
    return { userId: null, error: new Error("Supabase admin client not available") };
  }

  if (typeof admin.getUserByEmail === "function") {
    const { data, error } = await admin.getUserByEmail(email);
    if (error) return { userId: null, error };
    return { userId: data?.user?.id ?? null, error: null };
  }

  if (typeof admin.listUsers === "function") {
    const perPage = 200;
    for (let page = 1; page <= 100; page += 1) {
      const { data, error } = await admin.listUsers({ page, perPage });
      if (error) return { userId: null, error };
      const users = Array.isArray(data?.users) ? data.users : Array.isArray(data) ? data : [];
      const match = users.find((user: any) => typeof user?.email === "string" && user.email.toLowerCase() === email);
      if (match?.id) return { userId: match.id, error: null };
      if (users.length < perPage) break;
    }
    return { userId: null, error: null };
  }

  return { userId: null, error: new Error("Supabase admin user lookup not supported") };
}

export async function getGuardianById(
  guardian_id: string,
  org_id: string,
): Promise<{ data: GuardianDto | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await client
    .from("guardian_contacts")
    .select(
      `
      id,
      org_id,
      user_id,
      full_name,
      email,
      phone,
      address_line1,
      address_line2,
      city,
      region,
      postal_code,
      country,
      athlete_guardians(athlete_id, relationship)
    `,
    )
    .eq("id", guardian_id)
    .eq("org_id", org_id)
    .maybeSingle();

  if (error) return { data: null, error };
  return { data: data ? mapGuardianRow(data) : null, error: null };
}

export async function listGuardians(
  filters: GuardianListFilterInput,
): Promise<{ data: GuardianDto[]; count: number; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], count: 0, error: new Error("Supabase client not initialized") };
  }

  const { org_id, name, limit, offset } = filters;
  const rangeTo = offset + (limit - 1);

  let query = client
    .from("guardian_contacts")
    .select(
      `
      id,
      org_id,
      user_id,
      full_name,
      email,
      phone,
      address_line1,
      address_line2,
      city,
      region,
      postal_code,
      country,
      athlete_guardians(athlete_id, relationship)
    `,
      { count: "exact" },
    )
    .eq("org_id", org_id)
    .range(offset, rangeTo)
    .order("full_name", { ascending: true });

  if (name) {
    query = query.ilike("full_name", `%${name}%`);
  }

  const { data, error, count } = await query;
  if (error) return { data: [], count: 0, error };

  const items = (data ?? []).map((row: any) => mapGuardianRow(row));
  return { data: items, count: count ?? items.length, error: null };
}

export async function updateGuardian(
  guardian_id: string,
  org_id: string,
  input: UpdateGuardianInput,
): Promise<{ data: GuardianDto | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { data: guardianRow, error: guardianError } = await client
    .from("guardian_contacts")
    .select("id, user_id")
    .eq("id", guardian_id)
    .eq("org_id", org_id)
    .maybeSingle();

  if (guardianError) {
    return { data: null, error: guardianError };
  }
  if (!guardianRow?.id) {
    return { data: null, error: new Error("Guardian not found") };
  }

  const patch: Record<string, unknown> = {};
  if (input.full_name !== undefined) patch.full_name = input.full_name;
  if (input.email !== undefined) patch.email = input.email;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.address_line1 !== undefined) patch.address_line1 = input.address_line1;
  if (input.address_line2 !== undefined) patch.address_line2 = input.address_line2;
  if (input.city !== undefined) patch.city = input.city;
  if (input.region !== undefined) patch.region = input.region;
  if (input.postal_code !== undefined) patch.postal_code = input.postal_code;
  if (input.country !== undefined) patch.country = input.country;

  if (Object.keys(patch).length > 0) {
    const { data, error } = await client
      .from("guardian_contacts")
      .update(patch)
      .eq("id", guardian_id)
      .eq("org_id", org_id)
      .select("id");

    if (error) return { data: null, error };
    if (!data || data.length === 0) {
      return { data: null, error: new Error("Guardian not found") };
    }
  }

  const profilePatch: Record<string, unknown> = {};
  if (input.full_name !== undefined) profilePatch.full_name = input.full_name;
  if (input.email !== undefined) profilePatch.email = input.email;
  if (input.phone !== undefined) profilePatch.phone = input.phone;

  if (guardianRow.user_id && Object.keys(profilePatch).length > 0) {
    const { error: profileError } = await client
      .from("profiles")
      .update(profilePatch)
      .eq("user_id", guardianRow.user_id);
    if (profileError) return { data: null, error: profileError };
  }

  const removeIds = input.remove_athlete_ids ?? [];
  if (removeIds.length > 0) {
    const { error: removeError } = await client
      .from("athlete_guardians")
      .delete()
      .eq("guardian_id", guardian_id)
      .in("athlete_id", removeIds);
    if (removeError) return { data: null, error: removeError };
  }

  const addItems = input.add_athletes ?? [];
  if (addItems.length > 0) {
    const deduped = new Map<string, string>();
    for (const item of addItems) {
      deduped.set(item.athlete_id, item.relationship);
    }
    const rows = Array.from(deduped.entries()).map(([athlete_id, relationship]) => ({
      athlete_id,
      guardian_id,
      relationship,
    }));

    const { error: addError } = await client
      .from("athlete_guardians")
      .upsert(rows, { onConflict: "athlete_id,guardian_id" });
    if (addError) return { data: null, error: addError };
  }

  return await getGuardianById(guardian_id, org_id);
}

export async function createGuardian(
  input: CreateGuardianInput,
): Promise<{ data: GuardianDto | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const email = input.email.trim().toLowerCase();
  const { userId: existingUserId, error: userLookupError } = await findUserIdByEmail(client, email);
  if (userLookupError) {
    return { data: null, error: userLookupError };
  }
  if (existingUserId) {
    return { data: null, error: new Error("user already exists") };
  }

  const { data: existingGuardian, error: guardianLookupError } = await client
    .from("guardian_contacts")
    .select("id")
    .eq("org_id", input.org_id)
    .ilike("email", input.email)
    .maybeSingle();

  if (guardianLookupError) {
    return { data: null, error: guardianLookupError };
  }
  if (existingGuardian?.id) {
    return { data: null, error: new Error("guardian already exists") };
  }

  const { data: created, error: createErr } = await client.auth.admin.createUser({
    email: input.email,
    password: input.password,
    user_metadata: {
      full_name: input.full_name,
      cell_number: input.phone ?? null,
    },
    app_metadata: { role: "parent" },
    email_confirm: true,
  });

  if (createErr) {
    return { data: null, error: createErr };
  }

  const userId = created.user?.id ?? null;
  if (!userId) {
    return { data: null, error: new Error("User was not returned by Supabase") };
  }

  const { data: txData, error: txErr } = await client.rpc("create_guardian_tx", {
    p_user_id: userId,
    p_org_id: input.org_id,
    p_athlete_ids: input.athlete_ids,
    p_full_name: input.full_name,
    p_email: input.email,
    p_phone: input.phone ?? null,
    p_address_line1: input.address_line1 ?? null,
    p_address_line2: input.address_line2 ?? null,
    p_city: input.city ?? null,
    p_region: input.region ?? null,
    p_postal_code: input.postal_code ?? null,
    p_country: input.country ?? null,
    p_relationship: input.relationship,
  });

  if (txErr) {
    await client.auth.admin.deleteUser(userId).catch(() => {});
    return { data: null, error: txErr };
  }

  const guardianId =
    typeof txData === "string"
      ? txData
      : Array.isArray(txData)
        ? (txData[0]?.guardian_id ?? null)
        : ((txData as any)?.guardian_id ?? null);

  if (!guardianId) {
    await client.auth.admin.deleteUser(userId).catch(() => {});
    return { data: null, error: new Error("Failed to create guardian") };
  }

  const guardianResult = await getGuardianById(guardianId, input.org_id);
  if (guardianResult.error || !guardianResult.data) {
    try {
      await client.from("guardian_contacts").delete().eq("id", guardianId).eq("org_id", input.org_id);
    } catch {
      // ignore cleanup failure
    }
    await client.auth.admin.deleteUser(userId).catch(() => {});
    return {
      data: null,
      error: guardianResult.error ?? new Error("Failed to load created guardian"),
    };
  }

  try {
    const welcomeName = guardianResult.data.full_name ?? input.full_name ?? null;
    const data: Record<string, unknown> = { role: "parent", user_id: userId };
    const { actionLink } = await generateMagicLink(input.email, { data });
    await sendWelcomeEmail(input.email, welcomeName, actionLink);
  } catch (emailErr) {
    console.error("[createGuardian] welcome email failed", emailErr);
  }

  return guardianResult;
}

export async function deleteGuardian(
  guardian_id: string,
  org_id: string,
): Promise<{ data: { id: string } | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await client
    .from("guardian_contacts")
    .delete()
    .eq("id", guardian_id)
    .eq("org_id", org_id)
    .select("id");

  if (error) return { data: null, error };
  if (!data || data.length === 0) {
    return { data: null, error: new Error("Guardian not found") };
  }

  return { data: { id: data[0].id }, error: null };
}
