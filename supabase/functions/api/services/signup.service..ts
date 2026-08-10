import { notifyAthleteJoined, notifyCoachJoined } from "./notification.service.ts";
import { sbAdmin } from "./supabase.ts";

export async function rpcRegisterAthlete(args: Record<string, unknown>) {
  const client = sbAdmin;
  if (!client) {
    throw new Error("Supabase client not initialized");
  }
  const result = await client!.rpc("signup_register_athlete_with_code_tx", args);

  if(!result.success) {
    throw new Error(`Error registering athlete: ${result.error}`);
  }
  
  const { data: code_data, error: teamError } = await client
    .from("join_codes")
    .select(
      `
      code,
      org_id,
      created_by,
      team:teams!inner (
        name
      )
    `,
    )
    .eq("code", args.p_code)
    .maybeSingle();

  if (teamError) {
    throw new Error(`Error fetching join code: ${teamError.message}`);
  }

  const { data: athlete, error: athleteError } = await client
    .from("athletes")
    .select(
      `
      id,
      full_name
    `,
    )
    .eq("user_id", args.p_user_id)
    .maybeSingle();

  if (athleteError) {
    throw new Error(`Error fetching athlete: ${athleteError.message}`);
  }

  await notifyAthleteJoined({
    org_id: code_data.org_id as string,
    teamName: code_data?.team?.name as string,
    athleteId: athlete?.id as string,
    athleteName: athlete?.full_name as string,
    user_id: code_data?.created_by as string,
  });

  return result;
}

export async function rpcRegisterCoach(args: Record<string, unknown>) {

  const client = sbAdmin;
  if (!client) {
    throw new Error("Supabase client not initialized");
  }

  const result = await client!.rpc("signup_register_coach_with_code_tx", args);
  if(!result.success) {
    throw new Error(`Error registering coach: ${result.error}`);
  }

  const { data: code_data, error: teamError } = await client
    .from("join_codes")
    .select(
      `
      code,
      org_id,
      created_by,
      team:teams!inner (
        name
      )
    `,
    )
    .eq("code", args.p_code)
    .maybeSingle();

  if (teamError) {
    throw new Error(`Error fetching join code: ${teamError.message}`);
  }

  const { data: coach, error: coachError } = await client
    .from("coaches")
    .select(
      `
      id,
      full_name
    `,
    )
    .eq("user_id", args.p_user_id)
    .maybeSingle();

  if (coachError) {
    throw new Error(`Error fetching coach: ${coachError.message}`);
  }

  await notifyCoachJoined({
    org_id: code_data.org_id as string,
    teamName: code_data?.team?.name as string,
    coachId: coach?.id as string,
    coachName: coach?.full_name as string,
    user_id: code_data?.created_by as string,
  });

  return result;
}

export async function rpcRegisterParent(args: Record<string, unknown>) {
  return await sbAdmin!.rpc("signup_register_parent_with_code_tx", args);
}
