import { Router } from "./router.ts";
import {
  createDrillController,
  createDrillMediaBatchUploadController,
  createDrillMediaController,
  createDrillMediaUploadUrlController,
  getDrillMediaPlaybackController,
  updateDrillController,
  listDrillsController,
  listDrillTagsController,
  listSegmentsController,
  getDrillByIdController,
} from "../controllers/drills.controller.ts";
import { orgRoleGuardFromBody, orgRoleGuardFromQuery } from "../utils/guards.ts";

export function createDrillsRouter(): Router {
  const router = new Router();

  router.add("POST", "", createDrillController, [orgRoleGuardFromBody("org_id", ["coach"])]);
  router.add("POST", "media/batch-upload", createDrillMediaBatchUploadController);
  router.add("POST", "media/upload-url", createDrillMediaUploadUrlController, [
    orgRoleGuardFromBody("org_id", ["coach"]),
  ]);
  router.add("POST", "media", createDrillMediaController, [orgRoleGuardFromBody("org_id", ["coach"])]);
  router.add("GET", "media/:drill_id/play", getDrillMediaPlaybackController);
  router.add("GET", "list", listDrillsController, [orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"])]);
  router.add("GET", "segments", listSegmentsController);
  router.add("GET", "tags", listDrillTagsController, [orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"])]);
  router.add("PATCH", ":id", updateDrillController);
  router.add("GET", ":id", getDrillByIdController, [orgRoleGuardFromQuery("org_id", ["coach", "athlete", "parent"])]);

  return router;
}
