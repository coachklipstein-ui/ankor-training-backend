import { Router } from "./router.ts";
import {
  createManagedUserController,
  deleteManagedUserController,
  getManagedUserController,
  listManagedUsersController,
  listOrgUsersController,
  updateManagedUserController,
} from "../controllers/users.controller.ts";
import { orgRoleGuardFromQuery, sysAdminGuard } from "../utils/guards.ts";

export function createUsersRouter(): Router {
  const router = new Router();

  router.add("GET", "", listManagedUsersController, [sysAdminGuard()]);
  router.add("POST", "", createManagedUserController, [sysAdminGuard()]);

  router.add("GET", "list", listOrgUsersController, [orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"])]);

  router.add("GET", ":id", getManagedUserController, [sysAdminGuard()]);
  router.add("PATCH", ":id", updateManagedUserController, [sysAdminGuard()]);
  router.add("DELETE", ":id", deleteManagedUserController, [sysAdminGuard()]);

  return router;
}
