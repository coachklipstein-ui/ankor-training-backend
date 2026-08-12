import { sbAdmin } from "./supabase.ts";
import { generateMagicLink, sendWelcomeEmail } from "./email.service.ts";
import { deleteAuthUserIfCreated, ensureAuthUser } from "./auth_user.service.ts";
import type {
  AthleteDto,
  AthleteListFilterInput,
  AthleteTeamDto,
  CreateAthleteInput,
  UpdateAthleteInput,
} from "../dtos/athletes.dto.ts";

function buildFullName(first?: string | null, last?: string | null): string | null {
  const parts = [first?.trim(), last?.trim()].filter((part) => part && part.length > 0) as string[];
  if (parts.length === 0) return null;
  return parts.join(" ");
}

function mapAthleteRow(row: any): AthleteDto {
  const profile = row.profile ?? null;
  const teamRows = Array.isArray(row.team_athletes) ? row.team_athletes : row.team_athletes ? [row.team_athletes] : [];
  const guardianRows = Array.isArray(row.athlete_guardians)
    ? row.athlete_guardians
    : row.athlete_guardians
      ? [row.athlete_guardians]
      : [];
  const guardianRow = guardianRows[0] ?? null;
  const guardian = guardianRow?.guardian ?? null;
  const guardianRelationship = guardianRow?.relationship ?? null;

  const teamsById = new Map<string, AthleteTeamDto>();
  for (const item of teamRows) {
    const status = item?.status ?? null;
    if (status && status !== "active") continue;
    const team = item?.team ?? null;
    const teamId = item?.team_id ?? team?.id ?? null;
    if (!teamId) continue;
    if (!teamsById.has(teamId)) {
      teamsById.set(teamId, {
        id: teamId,
        name: team?.name ?? null,
      });
    }
  }

  return {
    id: row.id,
    org_id: row.org_id ?? null,
    user_id: row.user_id ?? null,
    first_name: row.first_name ?? null,
    last_name: row.last_name ?? null,
    full_name: row.full_name ?? null,
    email: profile?.email ?? row.email ?? null,
    phone: row.phone ?? null,
    cell_number: row.cell_number ?? null,
    gender: row.gender ?? null,
    graduation_year: row.graduation_year ?? null,
    teams: Array.from(teamsById.values()),
    parent: guardian
      ? {
          full_name: guardian.full_name ?? null,
          email: guardian.email ?? null,
          phone_number: guardian.phone ?? null,
          relationship: guardianRelationship ?? null,
        }
      : null,
  };
}

export async function listAthletes(
  filters: AthleteListFilterInput,
): Promise<{ data: AthleteDto[]; count: number; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: [], count: 0, error: new Error("Supabase client not initialized") };
  }

  const { org_id, name, email, team_id, limit, offset } = filters;
  const rangeTo = offset + (limit - 1);

  const teamEmbed = team_id
    ? "team_athletes!inner(team_id, status, team:teams(id, name))"
    : "team_athletes(team_id, status, team:teams(id, name))";

  let query = client
    .from("athletes")
    .select(
      `
      id,
      org_id,
      user_id,
      email,
      first_name,
      last_name,
      full_name,
      phone,
      cell_number,
      gender,
      graduation_year,
      profile:profiles(email),
      ${teamEmbed}
    `,
      { count: "exact" },
    )
    .eq("org_id", org_id)
    .range(offset, rangeTo)
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });

  if (name) {
    query = query.or(`full_name.ilike.%${name}%,first_name.ilike.%${name}%,last_name.ilike.%${name}%`);
  }
  if (email) {
    query = query.ilike("profiles.email", `%${email}%`);
  }
  if (team_id) {
    query = query.eq("team_athletes.team_id", team_id).eq("team_athletes.status", "active");
  }

  const { data, error, count } = await query;
  if (error) return { data: [], count: 0, error };

  const items = (data ?? []).map((row: any) => mapAthleteRow(row));
  return { data: items, count: count ?? items.length, error: null };
}

export async function getAthleteById(
  athlete_id: string,
  org_id: string,
): Promise<{ data: AthleteDto | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await client
    .from("athletes")
    .select(
      `
      id,
      org_id,
      user_id,
      email,
      first_name,
      last_name,
      full_name,
      phone,
      cell_number,
      gender,
      graduation_year,
      profile:profiles(email),
      team_athletes(team_id, status, team:teams(id, name)),
      athlete_guardians(relationship, guardian:guardian_contacts(full_name, email, phone))
    `,
    )
    .eq("id", athlete_id)
    .eq("org_id", org_id)
    .maybeSingle();

  if (error) return { data: null, error };

  return { data: data ? mapAthleteRow(data) : null, error: null };
}

export async function createAthlete(input: CreateAthleteInput): Promise<{ data: AthleteDto | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const full_name = input.full_name ?? buildFullName(input.first_name, input.last_name);
  const athleteEmail = input.email.trim();
  const { data: existingAthletes, error: existingAthletesError } = await client
    .from("athletes")
    .select("id")
    .eq("org_id", input.org_id)
    .ilike("email", athleteEmail)
    .limit(1);
  if (existingAthletesError) {
    return { data: null, error: existingAthletesError };
  }
  if ((existingAthletes ?? []).length > 0) {
    return { data: null, error: new Error("athlete email already exists") };
  }

  let positionId: string | null = null;
  if (input.position_id) {
    const { data: positionRow, error: positionError } = await client
      .from("positions")
      .select("id")
      .eq("id", input.position_id)
      .maybeSingle();

    if (positionError) {
      return { data: null, error: positionError };
    }

    if (!positionRow?.id) {
      return { data: null, error: new Error("Position not found") };
    }
    positionId = positionRow.id;
  }

  const guardianEmail = input.parent_email?.trim() ?? null;
  const guardianPhone = input.parent_mobile_phone?.trim() ?? null;
  const guardianFullName = input.parent_full_name?.trim() ?? null;
  const guardianRelationship = input.relationship ?? null;
  const hasGuardianInfo = Boolean(guardianEmail || guardianPhone || guardianFullName || guardianRelationship);
  const guardianMatchesAthlete = guardianEmail ? athleteEmail.toLowerCase() === guardianEmail.toLowerCase() : false;

  let guardianRow: { id?: string | null; user_id?: string | null } | null = null;
  if (guardianEmail) {
    const { data: guardianByEmail, error: guardianEmailErr } = await client
      .from("guardian_contacts")
      .select("id, user_id")
      .eq("org_id", input.org_id)
      .ilike("email", guardianEmail)
      .maybeSingle();

    if (guardianEmailErr) {
      return { data: null, error: guardianEmailErr };
    }

    guardianRow = guardianByEmail ?? null;
  }

  const guardianUserIdFromEmail = typeof guardianRow?.user_id === "string" ? guardianRow.user_id.trim() : null;

  let userId: string | null = null;
  let athleteUserCreated = false;

  let guardianId = guardianRow?.id ?? null;
  let guardianUserId: string | null = guardianUserIdFromEmail;
  let guardianUserCreated = false;

  // 1. if the guardian and athlete has the same email but the guardian does exits then create the parent
  if (hasGuardianInfo && !guardianUserIdFromEmail && guardianEmail && guardianFullName && guardianPhone) {
    const firstName = guardianFullName.split("")[0];
    const lastName = guardianFullName.split("")[1];

    const { data: ensuredGuardian, error: ensureGuardianErr } = await ensureAuthUser({
      email: guardianEmail,
      password: input.password,
      role: "parent",
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        full_name: guardianFullName,
        cell_number: guardianPhone,
      },
    });

    if (ensureGuardianErr || !ensuredGuardian) {
      return { data: null, error: ensureGuardianErr ?? new Error("Failed to ensure guardian auth user") };
    }

    guardianUserId = ensuredGuardian.userId;
    guardianUserCreated = ensuredGuardian.created;
  }

  //creating athlete user when parent email and athlete email are different
  if (!guardianMatchesAthlete) {
    const { data: ensuredAthlete, error: ensureAthleteErr } = await ensureAuthUser({
      email: athleteEmail,
      password: input.password,
      role: "athlete",
      user_metadata: {
        first_name: input.first_name,
        last_name: input.last_name,
        cell_number: input.cell_number ?? null,
      },
    });

    if (ensureAthleteErr || !ensuredAthlete) {
      await deleteAuthUserIfCreated(guardianUserId, guardianUserCreated);
      return { data: null, error: ensureAthleteErr ?? new Error("Failed to ensure athlete auth user") };
    }

    userId = ensuredAthlete.userId;
    athleteUserCreated = ensuredAthlete.created;
  }

  if (guardianMatchesAthlete) {
    if (!guardianUserId && userId) {
      guardianUserId = userId;
    }
    if (!userId && guardianUserId) {
      userId = guardianUserId;
    }
  }

  const { data: txData, error: txErr } = await client.rpc("create_athlete_tx", {
    p_user_id: userId,
    p_org_id: input.org_id,
    p_team_id: input.team_id,
    p_first_name: input.first_name,
    p_last_name: input.last_name,
    p_full_name: full_name,
    p_email: athleteEmail,
    p_phone: input.phone ?? null,
    p_cell_number: input.cell_number ?? null,
    p_gender: input.gender,
    p_guardian_id: guardianId,
    p_guardian_user_id: guardianUserId,
    p_guardian_full_name: guardianFullName,
    p_guardian_email: guardianEmail,
    p_guardian_phone: guardianPhone,
    p_guardian_relationship: guardianRelationship,
    p_graduation_year: input.graduation_year ?? null,
  });

  if (txErr) {
    await deleteAuthUserIfCreated(userId, athleteUserCreated);
    await deleteAuthUserIfCreated(guardianUserId, guardianUserCreated);
    return { data: null, error: txErr };
  }

  const athleteId =
    typeof txData === "string"
      ? txData
      : Array.isArray(txData)
        ? (txData[0]?.athlete_id ?? null)
        : ((txData as any)?.athlete_id ?? null);

  if (!athleteId) {
    await deleteAuthUserIfCreated(userId, athleteUserCreated);
    await deleteAuthUserIfCreated(guardianUserId, guardianUserCreated);
    return { data: null, error: new Error("Failed to create athlete") };
  }

  if (positionId) {
    const { error: positionsError } = await client.from("athlete_positions").insert({
      athlete_id: athleteId,
      position_id: positionId,
    });

    if (positionsError) {
      try {
        await client.from("athletes").delete().eq("id", athleteId).eq("org_id", input.org_id);
      } catch {
        // ignore cleanup failure
      }
      await deleteAuthUserIfCreated(userId, athleteUserCreated);
      await deleteAuthUserIfCreated(guardianUserId, guardianUserCreated);
      if (guardianUserCreated && guardianEmail) {
        try {
          await client.from("guardian_contacts").delete().eq("org_id", input.org_id).ilike("email", guardianEmail);
        } catch {
          // ignore cleanup failure
        }
      }
      return { data: null, error: positionsError };
    }
  }

  const athleteResult = await getAthleteById(athleteId, input.org_id);
  if (athleteResult.error || !athleteResult.data) {
    try {
      await client.from("athletes").delete().eq("id", athleteId).eq("org_id", input.org_id);
    } catch {
      // ignore cleanup failure
    }
    await deleteAuthUserIfCreated(userId, athleteUserCreated);
    await deleteAuthUserIfCreated(guardianUserId, guardianUserCreated);
    if (guardianUserCreated && guardianEmail) {
      try {
        await client.from("guardian_contacts").delete().eq("org_id", input.org_id).ilike("email", guardianEmail);
      } catch {
        // ignore cleanup failure
      }
    }
    return {
      data: null,
      error: athleteResult.error ?? new Error("Failed to load created athlete"),
    };
  }

  try {
    const welcomeName = athleteResult.data.full_name ?? full_name ?? buildFullName(input.first_name, input.last_name);
    const role = guardianMatchesAthlete ? "parent" : "athlete";
    const data: Record<string, unknown> = { role };
    if (userId) data.user_id = userId;

    const { actionLink } = await generateMagicLink(athleteEmail, { data });
    await sendWelcomeEmail(athleteEmail, welcomeName ?? null, actionLink);
  } catch (emailErr) {
    console.error("[createAthlete] welcome email failed", emailErr);
  }

  return athleteResult;
}

export async function updateAthlete(
  athlete_id: string,
  org_id: string,
  input: UpdateAthleteInput,
): Promise<{ data: AthleteDto | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const patch: Record<string, unknown> = {};
  if (input.user_id !== undefined) patch.user_id = input.user_id;
  if (input.first_name !== undefined) patch.first_name = input.first_name;
  if (input.last_name !== undefined) patch.last_name = input.last_name;
  if (input.full_name !== undefined) patch.full_name = input.full_name;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.cell_number !== undefined) patch.cell_number = input.cell_number;
  if (input.graduation_year !== undefined) patch.graduation_year = input.graduation_year;

  const needsFullName =
    input.full_name === undefined && (input.first_name !== undefined || input.last_name !== undefined);

  if (needsFullName) {
    const { data: current, error: currentError } = await client
      .from("athletes")
      .select("first_name, last_name")
      .eq("id", athlete_id)
      .eq("org_id", org_id)
      .maybeSingle();

    if (currentError) return { data: null, error: currentError };
    if (!current) return { data: null, error: new Error("Athlete not found") };

    const mergedFirst = input.first_name ?? current.first_name ?? null;
    const mergedLast = input.last_name ?? current.last_name ?? null;
    patch.full_name = buildFullName(mergedFirst, mergedLast);
  }

  if (Object.keys(patch).length > 0) {
    const { data, error } = await client
      .from("athletes")
      .update(patch)
      .eq("id", athlete_id)
      .eq("org_id", org_id)
      .select("id");

    if (error) return { data: null, error };
    if (!data || data.length === 0) {
      return { data: null, error: new Error("Athlete not found") };
    }
  } else {
    const { data, error } = await client.from("athletes").select("id").eq("id", athlete_id).eq("org_id", org_id);

    if (error) return { data: null, error };
    if (!data || data.length === 0) {
      return { data: null, error: new Error("Athlete not found") };
    }
  }

  return await getAthleteById(athlete_id, org_id);
}

export async function deleteAthlete(
  athlete_id: string,
  org_id: string,
): Promise<{ data: { id: string } | null; error: unknown }> {
  const client = sbAdmin;
  if (!client) {
    return { data: null, error: new Error("Supabase client not initialized") };
  }

  const { data, error } = await client.from("athletes").delete().eq("id", athlete_id).eq("org_id", org_id).select("id");

  if (error) return { data: null, error };
  if (!data || data.length === 0) {
    return { data: null, error: new Error("Athlete not found") };
  }

  return { data: { id: data[0].id }, error: null };
}
