import { Router } from "./router.ts";
import {
  bulkSkillDrillMapsController,
  createSkillDrillMapsController,
  deleteSkillDrillMapController,
  listSkillDrillMapsBySkillController,
  listSkillDrillMapsController,
  updateSkillDrillMapController,
} from "../controllers/skill_drill_map.controller.ts";
import { orgRoleGuardFromBody, orgRoleGuardFromQuery } from "../utils/guards.ts";

export function createSkillDrillMapRouter(): Router {
  const router = new Router();

  router.add("GET", "list", listSkillDrillMapsController, [
    orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"]),
  ]);

  router.add("POST", "bulk", bulkSkillDrillMapsController, [orgRoleGuardFromBody("org_id", ["coach"])]);

  router.add("GET", ":skill_id", listSkillDrillMapsBySkillController);

  router.add("POST", "", createSkillDrillMapsController, [orgRoleGuardFromBody("org_id", ["coach"])]);

  router.add("PATCH", ":skill_id/:drill_id", updateSkillDrillMapController);

  router.add("DELETE", ":skill_id/:drill_id", deleteSkillDrillMapController, [
    orgRoleGuardFromQuery("org_id", ["coach"]),
  ]);

  return router;
}
