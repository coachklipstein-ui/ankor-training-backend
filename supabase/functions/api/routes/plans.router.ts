import { Router } from "./router.ts";
import {
  createPlanController,
  getPlanByIdController,
  invitePlanMembersController,
  listInvitedPlansController,
  listPlansController,
  updatePlanController,
} from "../controllers/plans.controller.ts";
import {
  planCreateGuard,
  planReadGuard,
  planWriteGuard,
  orgRoleGuardFromQuery,
  userQueryGuard,
} from "../utils/guards.ts";

export function createPlansRouter(): Router {
  const router = new Router();

  router.add("GET", "list", listPlansController, [
    orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"]),
    userQueryGuard("user_id", { allowMissing: true }),
  ]);
  router.add("GET", "invited", listInvitedPlansController, [
    orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"]),
    userQueryGuard("user_id"),
  ]);
  router.add("GET", ":id", getPlanByIdController, [
    orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"]),
    planReadGuard(),
  ]);
  router.add("POST", ":id/invite", invitePlanMembersController, [
    orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"]),
    planWriteGuard(),
  ]);
  router.add("PATCH", ":id", updatePlanController, [
    orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"]),
    planWriteGuard(),
  ]);
  router.add("POST", "", createPlanController, [planCreateGuard()]);

  return router;
}
