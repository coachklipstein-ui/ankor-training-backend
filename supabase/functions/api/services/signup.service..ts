import { sbAdmin } from "./supabase.ts";

export async function rpcRegisterAthlete(args: Record<string, unknown>) {
  return await sbAdmin!.rpc("signup_register_athlete_with_code_tx", args);
}
export async function rpcRegisterCoach(args: Record<string, unknown>) {
  return await sbAdmin!.rpc("signup_register_coach_with_code_tx", args);
}
export async function rpcRegisterParent(args: Record<string, unknown>) {
  return await sbAdmin!.rpc("signup_register_parent_with_code_tx", args);
}
