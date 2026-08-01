import { Router } from "./router.ts";
import {
  createGuardianController,
  deleteGuardianController,
  getGuardianByIdController,
  listGuardiansController,
  updateGuardianController,
} from "../controllers/guardians.controller.ts";
import { orgRoleGuardFromBody, orgRoleGuardFromQuery } from "../utils/guards.ts";

export function createGuardiansRouter(): Router {
  const router = new Router();

  router.add("POST", "", createGuardianController, [orgRoleGuardFromBody("org_id", ["coach"])]);
  router.add("GET", "list", listGuardiansController, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("GET", ":id", getGuardianByIdController, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("PATCH", ":id", updateGuardianController, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("DELETE", ":id", deleteGuardianController, [orgRoleGuardFromQuery("org_id", ["coach"])]);

  return router;
}
