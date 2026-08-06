import { Router } from "./router.ts";
import {
  createManagedUserController,
  deleteManagedUserController,
  getManagedUserController,
  listManagedUsersController,
  listOrgUsersController,
  updateManagedUserController,
} from "../controllers/users.controller.ts";
import { orgRoleGuardFromQuery, adminOrSysAdminGuard } from "../utils/guards.ts";

export function createUsersRouter(): Router {
  const router = new Router();

  router.add("GET", "", listManagedUsersController, [adminOrSysAdminGuard()]);
  router.add("POST", "", createManagedUserController, [adminOrSysAdminGuard()]);

  router.add("GET", "list", listOrgUsersController, [orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"])]);

  router.add("GET", ":id", getManagedUserController, [adminOrSysAdminGuard()]);
  router.add("PATCH", ":id", updateManagedUserController, [adminOrSysAdminGuard()]);
  router.add("DELETE", ":id", deleteManagedUserController, [adminOrSysAdminGuard()]);

  return router;
}
