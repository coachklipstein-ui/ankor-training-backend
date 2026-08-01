import { Router } from "./router.ts";
import {
  createJoinCodeController,
  deleteJoinCodeController,
  getJoinCodeController,
  listJoinCodesController,
  updateJoinCodeController,
} from "../controllers/join_codes.controller.ts";
import { orgRoleGuardFromBody, orgRoleGuardFromQuery } from "../utils/guards.ts";

export function createJoinCodesRouter(): Router {
  const router = new Router();

  router.add("GET", "list", listJoinCodesController, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("GET", ":code", getJoinCodeController, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("POST", "", createJoinCodeController, [orgRoleGuardFromBody("org_id", ["coach"])]);
  router.add("PATCH", ":code", updateJoinCodeController, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("DELETE", ":code", deleteJoinCodeController, [orgRoleGuardFromQuery("org_id", ["coach"])]);

  return router;
}
