import { corsHeaders } from "./cors.ts";

export function json(body: unknown, origin?: string | null, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders(origin ?? "*") },
  });
}

export const badRequest = (msg: string, origin?: string | null) => json({ ok: false, error: msg }, origin, 400);
export const notFound = (msg: string, origin?: string | null) => json({ ok: false, error: msg }, origin, 404);
export const conflict = (msg: string, origin?: string | null) => json({ ok: false, error: msg }, origin, 409);
export const serverError = (msg: string, origin?: string | null) => json({ ok: false, error: msg }, origin, 500);
