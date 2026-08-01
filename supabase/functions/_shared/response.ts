import { corsHeaders } from "./cors.ts";
export function json(body: unknown, origin: string | null, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin ?? "*") },
  });
}
export const badRequest = (m: string, o: string | null) => json({ ok: false, error: m }, o, 400);
export const conflict = (m: string, o: string | null) => json({ ok: false, error: m }, o, 409);
export const serverError = (m: string, o: string | null) => json({ ok: false, error: m }, o, 500);
