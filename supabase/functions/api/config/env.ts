export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
export const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
export const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
export const DRILLS_MEDIA_BUCKET = Deno.env.get("DRILLS_MEDIA_BUCKET") ?? "drill-media";
export const SKILLS_MEDIA_BUCKET = Deno.env.get("SKILLS_MEDIA_BUCKET") ?? "skills-media";
export const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
/** @deprecated Prefer EMAIL_FROM; kept for backwards compatibility with existing deploys. */
export const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "";
export const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "";
export const EMAIL_TRANSPORT = Deno.env.get("EMAIL_TRANSPORT") ?? "";
export const SMTP_HOST = Deno.env.get("SMTP_HOST") ?? "";
export const SMTP_PORT = Deno.env.get("SMTP_PORT") ?? "";
export const INVITE_REDIRECT_URL = Deno.env.get("INVITE_REDIRECT_URL") ?? "";

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  throw new Error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ANON_KEY.");
}
