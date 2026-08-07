import { Router } from "./router.ts";
import {
  handleNotificationsList,
  handleNotificationById,
  handleMarkNotificationRead,
  handleMarkAllNotificationsRead,
} from "../controllers/notification.controller.ts";
import { authMiddleware } from "../utils/auth.ts";

export function createNotificationsRouter(): Router {
  const router = new Router();
  const requireAuth = authMiddleware();
  router.add("GET", "list", handleNotificationsList, [requireAuth]);
  router.add("PATCH", "read-all", handleMarkAllNotificationsRead, [requireAuth]);
  router.add("GET", ":id", handleNotificationById, [requireAuth]);
  router.add("PATCH", ":id/read", handleMarkNotificationRead, [requireAuth]);

  return router;
}
