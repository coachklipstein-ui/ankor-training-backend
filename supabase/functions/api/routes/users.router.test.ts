import { assertEquals } from "jsr:@std/assert";
import { createUsersRouter } from "./users.router.ts";

function request(path: string): Request {
  return new Request(`http://localhost/${path}`);
}

Deno.test("users list route is registered before dynamic id route", () => {
  const routes = createUsersRouter().getRoutes();
  const listIndex = routes.findIndex((route) => route.method === "GET" && route.path === "list");
  const idIndex = routes.findIndex((route) => route.method === "GET" && route.path === ":id");

  assertEquals(listIndex >= 0, true);
  assertEquals(idIndex >= 0, true);
  assertEquals(listIndex < idIndex, true);
});

Deno.test("GET /users/list uses org list validation instead of id validation", async () => {
  const router = createUsersRouter();
  const response = await router.handle("GET", "list", request("users/list?org_id=not-a-uuid"), null);

  assertEquals(response?.status, 400);
  assertEquals(await response?.json(), {
    ok: false,
    error: "org_id (UUID) is required",
  });
});
