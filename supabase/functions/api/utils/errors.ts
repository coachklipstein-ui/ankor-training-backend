export const SUPABASE_CLIENT_NOT_INITIALIZED = "Supabase client not initialized";

export function supabaseClientNotInitializedError(): Error {
  return new Error(SUPABASE_CLIENT_NOT_INITIALIZED);
}

export type ErrorResult = {
  ok: false;
  error: string;
};

export function errorResult(error: string): ErrorResult {
  return { ok: false, error };
}
