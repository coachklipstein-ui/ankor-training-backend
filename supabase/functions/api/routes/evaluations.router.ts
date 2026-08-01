import { Router } from "./router.ts";
import {
  bulkCreateEvaluationsController,
  handleEvaluationsList,
  handleLatestEvaluations,
  handleEvaluationAthletesById,
  handleEvaluationImprovementSkills,
  handleEvaluationSkillVideos,
  handleEvaluationSubskillRatings,
  handleEvaluationWorkoutSummary,
  handleEvaluationWorkoutProgress,
  handleIncrementWorkoutProgress,
  handleEvaluationWorkoutDrills,
  handleLatestEvaluationWorkoutDrills,
  handleEvaluationById,
  handleDeleteEvaluation,
  updateEvaluationMatrixController,
  handleSubmitEvaluation,
} from "../controllers/evaluations.controller.ts";
import { evaluationBulkOrgGuard, orgRoleGuardFromBody, orgRoleGuardFromQuery } from "../utils/guards.ts";

export function createEvaluationsRouter(): Router {
  const router = new Router();

  // POST /api/evaluations/bulk-create
  router.add("POST", "bulk-create", bulkCreateEvaluationsController, [evaluationBulkOrgGuard(["coach"])]);
  router.add("GET", "list", handleEvaluationsList, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("GET", "latest", handleLatestEvaluations, [
    orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"]),
  ]);
  router.add("GET", "latest/by-evaluation", handleEvaluationAthletesById, [
    orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"]),
  ]);
  router.add("GET", ":id/improvement-skills", handleEvaluationImprovementSkills, [
    orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"]),
  ]);
  router.add("GET", ":id/skill-videos", handleEvaluationSkillVideos, [
    orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"]),
  ]);
  router.add("GET", ":id/subskill-ratings", handleEvaluationSubskillRatings, [
    orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"]),
  ]);
  router.add("GET", "workout-summary", handleEvaluationWorkoutSummary, [
    orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"]),
  ]);
  router.add("GET", ":id/workout-progress", handleEvaluationWorkoutProgress, [
    orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"]),
  ]);
  router.add("GET", ":id/workout-drills", handleEvaluationWorkoutDrills, [
    orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"]),
  ]);
  router.add("GET", "workout-drills/latest", handleLatestEvaluationWorkoutDrills, [
    orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"]),
  ]);
  router.add("POST", ":id/workout-progress", handleIncrementWorkoutProgress, [
    orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"]),
  ]);
  router.add("GET", "eval/:id", handleEvaluationById, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("DELETE", "eval/:id", handleDeleteEvaluation, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("DELETE", ":id", handleDeleteEvaluation, [orgRoleGuardFromQuery("org_id", ["coach"])]);
  router.add("PATCH", "eval/:id/matrix", updateEvaluationMatrixController, [orgRoleGuardFromBody("org_id", ["coach"])]);
  router.add("POST", ":id/submit", handleSubmitEvaluation, [orgRoleGuardFromQuery("org_id", ["coach"])]);

  return router;
}
