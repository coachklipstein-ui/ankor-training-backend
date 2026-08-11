import {
  listNotifications,
  getNotificationById,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  type ListNotificationsFilters,
  type NotificationType,
} from "../services/notification.service.ts";
import { badRequest, internalError, json, methodNotAllowed, notFound } from "../utils/http.ts";
import { RE_UUID } from "../utils/uuid.ts";
import type { RequestContext } from "../routes/router.ts";

const NOTIFICATION_TYPES: NotificationType[] = [
  "evaluation_completed",
  "athlete_joined",
  "coach_joined",
  "plan_shared",
];

/**
 * GET /api/notifications/list
 *
 * Query params:
 *   org_id      — optional UUID filter
 *   type        — optional single type or comma-separated types
 *   unread_only — optional "true" to show only unread
 *   limit       — optional (default 50, max 100)
 *   offset      — optional (default 0)
 */
export async function handleNotificationsList(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "GET") return methodNotAllowed(["GET"]);

  const userId = ctx!.user!.id!;

  const url = new URL(req.url);

  const orgIdRaw = (url.searchParams.get("org_id") ?? "").trim();
  if (orgIdRaw && !RE_UUID.test(orgIdRaw)) {
    return badRequest("org_id must be a valid UUID");
  }

  const typeRaw = (url.searchParams.get("type") ?? "").trim();
  let typeFilter: NotificationType | NotificationType[] | undefined;
  if (typeRaw) {
    const types = typeRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean) as NotificationType[];
    const valid = types.filter((t) => NOTIFICATION_TYPES.includes(t));
    if (valid.length === 0) {
      return badRequest(`type must be one of: ${NOTIFICATION_TYPES.join(", ")}`);
    }
    typeFilter = valid.length === 1 ? valid[0] : valid;
  }

  const unreadOnlyRaw = (url.searchParams.get("unread_only") ?? "").trim().toLowerCase();
  const unreadOnly = unreadOnlyRaw === "true" || unreadOnlyRaw === "1";

  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const offsetRaw = Number.parseInt(url.searchParams.get("offset") ?? "", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

  const filters: ListNotificationsFilters = {
    user_id: userId,
    org_id: orgIdRaw || undefined,
    type: typeFilter,
    unread_only: unreadOnly || undefined,
    limit,
    offset,
  };

  const { data, count, error } = await listNotifications(filters);

  if (error) {
    console.error("[handleNotificationsList] error", error);
    return internalError(error);
  }

  return json(200, {
    ok: true,
    count,
    limit,
    offset,
    data,
  });
}

/**
 * GET /api/notifications/:id
 */
export async function handleNotificationById(
  req: Request,
  _origin?: string | null,
  params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "GET") return methodNotAllowed(["GET"]);

  const userId = ctx?.user?.id;
  if (!userId) return badRequest("Authentication required");

  const id = (params?.id ?? "").trim();
  if (!id || !RE_UUID.test(id)) return badRequest("id (UUID) is required");

  const { data, error } = await getNotificationById(id);

  if (error) {
    console.error("[handleNotificationById] error", error);
    return internalError(error);
  }
  if (!data) return notFound("Notification not found");

  if (data.user_id && data.user_id !== userId) {
    return notFound("Notification not found");
  }

  return json(200, { ok: true, data });
}

/**
 * PATCH /api/notifications/:id/read
 */
export async function handleMarkNotificationRead(
  req: Request,
  _origin?: string | null,
  params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "PATCH") return methodNotAllowed(["PATCH"]);

  const userId = ctx?.user?.id;
  if (!userId) return badRequest("Authentication required");

  const id = (params?.id ?? "").trim();
  if (!id || !RE_UUID.test(id)) return badRequest("id (UUID) is required");

  const { data: existing, error: fetchError } = await getNotificationById(id);
  if (fetchError) {
    console.error("[handleMarkNotificationRead] fetch error", fetchError);
    return internalError(fetchError);
  }
  if (!existing) return notFound("Notification not found");
  if (existing.user_id && existing.user_id !== userId) {
    return notFound("Notification not found");
  }

  const { data, error } = await markNotificationAsRead(id);

  if (error) {
    console.error("[handleMarkNotificationRead] error", error);
    return internalError(error);
  }

  return json(200, { ok: true, data });
}

/**
 * PATCH /api/notifications/read-all
 *
 * Body (optional):
 *   org_id — filter by org
 */
export async function handleMarkAllNotificationsRead(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "PATCH") return methodNotAllowed(["PATCH"]);

  const userId = ctx?.user?.id;
  if (!userId) return badRequest("Authentication required");

  let orgId: string | null = null;
  const body = await req.json().catch(() => null);
  if (body && typeof body === "object" && typeof (body as any).org_id === "string") {
    const raw = (body as any).org_id.trim();
    if (raw && !RE_UUID.test(raw)) {
      return badRequest("org_id must be a valid UUID");
    }
    orgId = raw || null;
  }

  const { count, error } = await markAllNotificationsAsRead({
    user_id: userId,
    org_id: orgId,
  });

  if (error) {
    console.error("[handleMarkAllNotificationsRead] error", error);
    return internalError(error);
  }

  return json(200, { ok: true, count });
}
