import { Router } from "./router.ts";
import {
  handleNotificationsList,
  handleNotificationById,
  handleMarkNotificationRead,
  handleMarkAllNotificationsRead,
} from "../controllers/notification.controller.ts";

export function createNotificationsRouter(): Router {
  const router = new Router();
  router.add("GET", "list", handleNotificationsList);
  router.add("PATCH", "read-all", handleMarkAllNotificationsRead);
  router.add("GET", ":id", handleNotificationById);
  router.add("PATCH", ":id/read", handleMarkNotificationRead);

  return router;
}
