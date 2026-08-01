import { Router } from "./router.ts";
import {
  handleScorecardsCreateTemplate,
  handleScorecardsList,
  handleScorecardById,
  handleScorecardDelete,
  handleScorecardUpdate,
  handleScorecardCategoriesByTemplate,
  handleScorecardSubskillsByCategory,
} from "../controllers/scorecard.controller.ts";
import { orgRoleGuardFromBody, orgRoleGuardFromQuery } from "../utils/guards.ts";

export function createScorecardsRouter(): Router {
  const router = new Router();

  // POST /api/scorecard
  router.add("POST", "", handleScorecardsCreateTemplate, [orgRoleGuardFromBody("org_id", ["coach"])]);

  // GET /api/scorecard/list
  router.add("GET", "list", handleScorecardsList, [orgRoleGuardFromQuery("org_id", ["coach"])]);

  router.add("GET", "categories", handleScorecardCategoriesByTemplate, [orgRoleGuardFromQuery("org_id", ["coach"])]);

  router.add("GET", "subskills", handleScorecardSubskillsByCategory, [orgRoleGuardFromQuery("org_id", ["coach"])]);

  // GET /api/scorecard/:id
  router.add("GET", ":id", handleScorecardById, [orgRoleGuardFromQuery("org_id", ["coach"])]);

  // PATCH /api/scorecard/:id
  router.add("PATCH", ":id", handleScorecardUpdate, [orgRoleGuardFromBody("org_id", ["coach"])]);
  router.add("DELETE", ":id", handleScorecardDelete, [orgRoleGuardFromQuery("org_id", ["coach"])]);

  return router;
}
