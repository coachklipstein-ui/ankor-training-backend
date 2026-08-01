// src/utils/http.ts

// Common CORS headers for Supabase Edge Functions
export const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper to build a JSON Response with CORS
export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

// Shortcut helpers
export function ok(body: unknown = { ok: true }): Response {
  return json(200, body);
}

export function created(body: unknown = { ok: true }): Response {
  return json(201, body);
}

export function badRequest(message: string): Response {
  return json(400, {
    ok: false,
    error: message,
  });
}

export function unauthorized(message = "Unauthorized"): Response {
  return json(401, {
    ok: false,
    error: message,
  });
}

export function forbidden(message = "Forbidden"): Response {
  return json(403, {
    ok: false,
    error: message,
  });
}

export function notFound(message = "Not found"): Response {
  return json(404, {
    ok: false,
    error: message,
  });
}

export function methodNotAllowed(allowed: string[] = ["GET", "POST"]): Response {
  return json(405, {
    ok: false,
    error: `Method not allowed. Allowed: ${allowed.join(", ")}`,
  });
}

export function internalError(err: unknown, fallback = "Internal Server Error"): Response {
  let message = fallback;
  if (err instanceof Error) {
    message = err.message;
  } else if (typeof err === "string") {
    message = err;
  } else if (err && typeof err === "object") {
    const value = err as { message?: unknown; details?: unknown; error?: unknown };
    if (typeof value.message === "string") message = value.message;
    else if (typeof value.details === "string") message = value.details;
    else if (typeof value.error === "string") message = value.error;
  }

  return json(500, {
    ok: false,
    error: message,
  });
}

// For handling OPTIONS preflight quickly in your index.ts
export function handleOptions(): Response {
  return new Response("ok", {
    status: 200,
    headers: {
      ...corsHeaders,
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    },
  });
}
