import { Router } from "./router.ts";
import {
  createAthleteController,
  deleteAthleteController,
  getAthleteByIdController,
  listAthletesController,
  updateAthleteController,
} from "../controllers/athletes.controller.ts";
import { orgRoleGuardFromBody, orgRoleGuardFromQuery } from "../utils/guards.ts";

export function createAthletesRouter(): Router {
  const router = new Router();

  router.add("POST", "", createAthleteController, [orgRoleGuardFromBody("org_id", ["coach"])]);
  router.add("GET", "list", listAthletesController, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("GET", ":id", getAthleteByIdController, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("PATCH", ":id", updateAthleteController, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("DELETE", ":id", deleteAthleteController, [orgRoleGuardFromQuery("org_id", ["coach"])]);

  return router;
}
