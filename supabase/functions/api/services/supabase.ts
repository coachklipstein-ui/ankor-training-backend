import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ANON_KEY, SUPABASE_URL, SERVICE_KEY } from "../config/env.ts";

export const sbAdmin: SupabaseClient | null = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const sbAnon: SupabaseClient | null = !ANON_KEY
  ? null
  : createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
