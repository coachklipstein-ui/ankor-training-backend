import { Router } from "./router.ts";
import {
  createCoachController,
  deleteCoachController,
  getCoachByIdController,
  getCoachSummaryController,
  listCoachesController,
  updateCoachController,
} from "../controllers/coaches.controller.ts";
import { orgRoleGuardFromBody, orgRoleGuardFromQuery } from "../utils/guards.ts";

export function createCoachesRouter(): Router {
  const router = new Router();

  router.add("POST", "", createCoachController, [orgRoleGuardFromBody("org_id", ["admin"])]);
  router.add("GET", "list", listCoachesController, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("GET", ":id", getCoachByIdController, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("GET", ":id/summary", getCoachSummaryController, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("PATCH", ":id", updateCoachController, [orgRoleGuardFromQuery("org_id", ["admin"])]);
  router.add("DELETE", ":id", deleteCoachController, [orgRoleGuardFromQuery("org_id", ["admin"])]);

  return router;
}
