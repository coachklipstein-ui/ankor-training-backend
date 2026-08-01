// src/controllers/teamsController.ts
import {
  createTeam,
  deleteTeam,
  getAthletesByTeam,
  getTeamById,
  getTeamsByOrgId,
  listTeamsWithAthletes,
  updateTeam,
} from "../services/teams.service.ts";
import { badRequest, created, internalError, json, methodNotAllowed, notFound } from "../utils/http.ts";
import { CreateTeamSchema, GetTeamByIdSchema, UpdateTeamSchema, type TeamDTO } from "../dtos/team.dto.ts";
import type { RequestContext } from "../routes/router.ts";
import { RE_UUID } from "../utils/uuid.ts";

type GetTeamsSuccess = {
  ok: true;
  data: TeamDTO[];
};

type GetTeamsError = {
  ok: false;
  error: string;
};

type GetTeamsResponseBody = GetTeamsSuccess | GetTeamsError;

function jsonResponse(body: GetTeamsResponseBody, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleTeamsWithAthletesList(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  try {
    if (req.method !== "GET") {
      return methodNotAllowed(["GET"]);
    }

    const url = new URL(req.url);
    const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
    if (!RE_UUID.test(org_id)) {
      return badRequest("org_id (UUID) is required");
    }

    const { data, error } = await listTeamsWithAthletes(org_id);

    if (error) {
      console.error("[handleTeamsWithAthletesList] list error", error);
      return internalError(error);
    }

    const teams = data ?? [];

    return json(200, {
      ok: true,
      count: teams.length,
      data: teams,
    });
  } catch (err) {
    console.error("[handleTeamsWithAthletesList] error", err);
    return internalError(err);
  }
}

export async function getTeamsController(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  try {
    if (req.method !== "GET") {
      return methodNotAllowed(["GET"]);
    }

    const url = new URL(req.url);
    const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
    if (!RE_UUID.test(org_id)) {
      return badRequest("org_id (UUID) is required");
    }

    const teams: TeamDTO[] = await getTeamsByOrgId(org_id);

    const body: GetTeamsSuccess = {
      ok: true,
      data: teams,
    };

    return jsonResponse(body, 200);
  } catch (err) {
    console.error("getTeamsController unexpected error:", err);

    const body: GetTeamsError = {
      ok: false,
      error: "Unexpected error fetching teams",
    };

    return jsonResponse(body, 500);
  }
}

export async function getTeamByIdController(
  req: Request,
  _origin?: string | null,
  params?: { id?: string },
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const team_id = params?.id;
  if (!team_id) {
    return badRequest("Missing 'id' path parameter");
  }

  const idParsed = GetTeamByIdSchema.safeParse({ team_id });
  if (!idParsed.success) {
    const message = idParsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const url = new URL(req.url);
  const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const { data, error } = await getTeamById(idParsed.data.team_id, org_id);
  if (error) {
    console.error("[getTeamByIdController] fetch error", error);
    return internalError(error, "Failed to fetch team");
  }

  if (!data) {
    return notFound("Team not found");
  }

  return json(200, { ok: true, team: data });
}

export async function createTeamController(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
): Promise<Response> {
  if (req.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return badRequest("Invalid JSON payload");
  }

  const parsed = CreateTeamSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const { data, error } = await createTeam(parsed.data);
  if (error) {
    console.error("[createTeamController] create error", error);
    return internalError(error, "Failed to create team");
  }

  return created({ ok: true, team: data });
}

export async function updateTeamController(
  req: Request,
  _origin?: string | null,
  params?: { id?: string },
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "PATCH") {
    return methodNotAllowed(["PATCH"]);
  }

  const team_id = params?.id;
  if (!team_id) {
    return badRequest("Missing 'id' path parameter");
  }

  const idParsed = GetTeamByIdSchema.safeParse({ team_id });
  if (!idParsed.success) {
    const message = idParsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const url = new URL(req.url);
  const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return badRequest("Invalid JSON payload");
  }

  const parsed = UpdateTeamSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const { data, error } = await updateTeam(idParsed.data.team_id, org_id, parsed.data);
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("not found")) {
      return notFound("Team not found");
    }
    console.error("[updateTeamController] update error", error);
    return internalError(error, "Failed to update team");
  }

  return json(200, { ok: true, team: data });
}

export async function deleteTeamController(
  req: Request,
  _origin?: string | null,
  params?: { id?: string },
  ctx?: RequestContext,
): Promise<Response> {
  if (req.method !== "DELETE") {
    return methodNotAllowed(["DELETE"]);
  }

  const team_id = params?.id;
  if (!team_id) {
    return badRequest("Missing 'id' path parameter");
  }

  const idParsed = GetTeamByIdSchema.safeParse({ team_id });
  if (!idParsed.success) {
    const message = idParsed.error.issues.map((issue) => issue.message).join("; ");
    return badRequest(message);
  }

  const url = new URL(req.url);
  const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();
  if (!RE_UUID.test(org_id)) {
    return badRequest("org_id (UUID) is required");
  }

  const { data, error } = await deleteTeam(idParsed.data.team_id, org_id);
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("not found")) {
      return notFound("Team not found");
    }
    console.error("[deleteTeamController] delete error", error);
    return internalError(error, "Failed to delete team");
  }

  return json(200, { ok: true, deleted: data });
}

export async function handleAthletesByTeam(
  req: Request,
  _origin?: string | null,
  _params?: Record<string, string>,
  ctx?: RequestContext,
): Promise<Response> {
  try {
    if (req.method !== "GET") {
      return methodNotAllowed(["GET"]);
    }

    const url = new URL(req.url);
    const teamId = url.searchParams.get("team_id");
    const org_id = (ctx?.org_id ?? url.searchParams.get("org_id") ?? "").trim();

    if (!teamId) {
      return badRequest("Query parameter 'team_id' is required.");
    }
    if (!RE_UUID.test(org_id)) {
      return badRequest("org_id (UUID) is required");
    }

    const { data, error } = await getAthletesByTeam(teamId, org_id);

    if (error) {
      console.error("[handleAthletesByTeam] error", error);
      return internalError(error);
    }

    const athletes = data ?? [];

    return json(200, {
      ok: true,
      count: athletes.length,
      data: athletes,
    });
  } catch (err) {
    console.error("[handleAthletesByTeam] unexpected error", err);
    return internalError(err);
  }
}
