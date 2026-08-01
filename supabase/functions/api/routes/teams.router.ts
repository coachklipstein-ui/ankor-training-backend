// src/routes/teams.router.ts
import { Router } from "./router.ts";
import {
  createTeamController,
  deleteTeamController,
  getTeamByIdController,
  getTeamsController,
  handleAthletesByTeam,
  handleTeamsWithAthletesList,
  updateTeamController,
} from "../controllers/teams.controller.ts";
import { orgRoleGuardFromBody, orgRoleGuardFromQuery } from "../utils/guards.ts";

export function createTeamsRouter(): Router {
  const router = new Router();

  // GET /api/teams/list-with-athletes
  router.add("GET", "list-with-athletes", handleTeamsWithAthletesList, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("GET", "list", getTeamsController, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("POST", "", createTeamController, [orgRoleGuardFromBody("org_id", ["coach"])]);
  router.add("GET", "athletes-by-team", handleAthletesByTeam, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("GET", ":id", getTeamByIdController, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("PATCH", ":id", updateTeamController, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("DELETE", ":id", deleteTeamController, [orgRoleGuardFromQuery("org_id", ["coach"])]);

  return router;
}
