import {
  createManagedUser,
  deleteManagedUser,
  getManagedUser,
  isManagedOrgRole,
  listManagedUsers,
  listOrgUsers,
  updateManagedUser,
  type CreateManagedUserInput,
  type UpdateManagedUserInput,
} from "../services/users.service.ts";
import { badRequest, created, internalError, json, methodNotAllowed, notFound } from "../utils/http.ts";
import type { RequestContext } from "../routes/router.ts";
import { RE_UUID } from "../utils/uuid.ts";

export async function listOrgUsersController(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const url = new URL(req.url);
  const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const { data, count, error } = await listOrgUsers(org_id);
  if (error) {
    console.error("[listOrgUsersController] list error", error);
    return internalError(error, "Failed to list users");
  }

  return json(200, { ok: true, count, items: data });
}

function readString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value.trim() : "";
}

function parseCreateManagedUser(body: unknown): { value?: CreateManagedUserInput; error?: string } {
  if (!body || typeof body !== "object") {
    return { error: "Invalid JSON payload" };
  }

  const obj = body as Record<string, unknown>;
  const org_id = readString(obj, "org_id");
  const email = readString(obj, "email");
  const password = readString(obj, "password");
  const role = readString(obj, "role");

  if (!org_id || !RE_UUID.test(org_id)) return { error: "org_id (UUID) is required" };
  if (!email) return { error: "email is required" };
  if (!password) return { error: "password is required" };
  if (!role || !isManagedOrgRole(role)) {
    return { error: "role must be one of: owner, admin, coach, athlete, parent, staff, viewer" };
  }

  return {
    value: {
      org_id,
      email,
      password,
      role,
      first_name: readString(obj, "first_name"),
      last_name: readString(obj, "last_name"),
      full_name: readString(obj, "full_name"),
      phone: readString(obj, "phone"),
      email_confirm: typeof obj.email_confirm === "boolean" ? obj.email_confirm : undefined,
    },
  };
}

function parseUpdateManagedUser(body: unknown): { value?: UpdateManagedUserInput; error?: string } {
  if (!body || typeof body !== "object") {
    return { error: "Invalid JSON payload" };
  }

  const obj = body as Record<string, unknown>;
  const org_id = readString(obj, "org_id");
  const role = readString(obj, "role");

  if (org_id !== null && org_id !== "" && !RE_UUID.test(org_id)) {
    return { error: "org_id (UUID) must be valid when provided" };
  }
  if (role !== null && role !== "" && !isManagedOrgRole(role)) {
    return { error: "role must be one of: owner, admin, coach, athlete, parent, staff, viewer" };
  }

  const value: UpdateManagedUserInput = {};
  if (org_id) value.org_id = org_id;
  if (role) value.role = role;

  for (const key of ["email", "password", "first_name", "last_name", "full_name", "phone"] as const) {
    if (key in obj) value[key] = readString(obj, key);
  }

  if ("is_active" in obj) {
    if (typeof obj.is_active !== "boolean") {
      return { error: "is_active must be a boolean" };
    }
    value.is_active = obj.is_active;
  }

  return { value };
}

export async function listManagedUsersController(req: Request): Promise<Response> {
  if (req.method !== "GET") return methodNotAllowed(["GET"]);

  const url = new URL(req.url);
  const org_id = (url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) return badRequest("org_id (UUID) is required");

  const { data, count, error } = await listManagedUsers(org_id);
  if (error) {
    console.error("[listManagedUsersController] list error", error);
    return internalError(error, "Failed to list managed users");
  }

  return json(200, { ok: true, count, data });
}

export async function getManagedUserController(
  req: Request,
  _origin?: string | null,
  params?: Record<string, string>,
): Promise<Response> {
  if (req.method !== "GET") return methodNotAllowed(["GET"]);

  const user_id = (params?.id ?? "").trim();
  if (!RE_UUID.test(user_id)) return badRequest("id (UUID) is required");

  const url = new URL(req.url);
  const org_id = (url.searchParams.get("org_id") ?? "").trim() || null;
  if (org_id && !RE_UUID.test(org_id)) return badRequest("org_id (UUID) must be valid");

  const { data, error } = await getManagedUser(user_id, org_id);
  if (error) {
    console.error("[getManagedUserController] get error", error);
    return internalError(error, "Failed to load user");
  }
  if (!data) return notFound("User not found");

  return json(200, { ok: true, data });
}

export async function createManagedUserController(req: Request): Promise<Response> {
  if (req.method !== "POST") return methodNotAllowed(["POST"]);

  const body = await req.json().catch(() => null);
  const parsed = parseCreateManagedUser(body);
  if (parsed.error || !parsed.value) return badRequest(parsed.error ?? "Invalid payload");

  const { data, error } = await createManagedUser(parsed.value);
  if (error) {
    console.error("[createManagedUserController] create error", error);
    return internalError(error, "Failed to create user");
  }

  return created({ ok: true, data });
}

export async function updateManagedUserController(
  req: Request,
  _origin?: string | null,
  params?: Record<string, string>,
): Promise<Response> {
  if (req.method !== "PATCH") return methodNotAllowed(["PATCH"]);

  const user_id = (params?.id ?? "").trim();
  if (!RE_UUID.test(user_id)) return badRequest("id (UUID) is required");

  const body = await req.json().catch(() => null);
  const parsed = parseUpdateManagedUser(body);
  if (parsed.error || !parsed.value) return badRequest(parsed.error ?? "Invalid payload");

  const { data, error } = await updateManagedUser(user_id, parsed.value);
  if (error) {
    console.error("[updateManagedUserController] update error", error);
    return internalError(error, "Failed to update user");
  }
  if (!data) return notFound("User not found");

  return json(200, { ok: true, data });
}

export async function deleteManagedUserController(
  req: Request,
  _origin?: string | null,
  params?: Record<string, string>,
): Promise<Response> {
  if (req.method !== "DELETE") return methodNotAllowed(["DELETE"]);

  const user_id = (params?.id ?? "").trim();
  if (!RE_UUID.test(user_id)) return badRequest("id (UUID) is required");

  const url = new URL(req.url);
  const org_id = (url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) return badRequest("org_id (UUID) is required");

  const hardDelete = (url.searchParams.get("hard_delete") ?? "").toLowerCase() === "true";
  const { data, error } = await deleteManagedUser(user_id, org_id, hardDelete);
  if (error) {
    console.error("[deleteManagedUserController] delete error", error);
    return internalError(error, "Failed to delete user");
  }

  return json(200, { ok: true, data });
}
