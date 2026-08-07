import { notifyCoachJoined } from "./notification.service.ts";
import { sbAdmin } from "./supabase.ts";

export async function rpcRegisterAthlete(args: Record<string, unknown>) {
  return await sbAdmin!.rpc("signup_register_athlete_with_code_tx", args);
}
export async function rpcRegisterCoach(args: Record<string, unknown>) {

  const client = sbAdmin;
  if (!client) {
    throw new Error("Supabase client not initialized");
  }

  const { data: teamData, error: teamError } = await client
    .from("join_codes")
    .select(
      `
      code,
      org_id,
      team:teams!inner (
        name
      )
    `,
    )
    .eq("code", args.p_code)
    .maybeSingle();

    if(teamError) {
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

    if(coachError) { 
      throw new Error(`Error fetching coach: ${coachError.message}`);
    }

    // await notifyCoachJoined({
    //   org_id: teamData.org_id as string,
    //   teamName: teamData?.team?.name as string,
    //   coachId: coach?.id as string,
    //   coachName: coach?.full_name as string,
    //   user_id: args.p_user_id as string,
    // });
  return await sbAdmin!.rpc("signup_register_coach_with_code_tx", args);
}
export async function rpcRegisterParent(args: Record<string, unknown>) {
  return await sbAdmin!.rpc("signup_register_parent_with_code_tx", args);
}
