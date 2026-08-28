import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AdminUser } from "../../shared/types";
import { db } from "../db/client";
import { users } from "../db/schema";
import {
  type AppEnv,
  invalidateUserSessions,
  requireAdmin,
  requireAuth,
} from "../lib/auth";
import {
  readJsonBody,
  validatePassword,
  validateUsername,
} from "../lib/validation";

const admin = new Hono<AppEnv>();
admin.use("*", requireAuth, requireAdmin);

admin.get("/users", async (c) => {
  const rows = await db.select().from(users).orderBy(asc(users.id));
  const result: AdminUser[] = rows.map(({ passwordHash: _, ...user }) => user);
  return c.json(result);
});

admin.post("/users", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const username = validateUsername(body.username);
  const password = validatePassword(body.password);
  const existing = await db.query.users.findFirst({
    where: eq(users.username, username),
  });
  if (existing) {
    return c.json({ error: "用户名已存在" }, 409);
  }

  const passwordHash = await Bun.password.hash(password, {
    algorithm: "argon2id",
  });
  const created = await db
    .insert(users)
    .values({ username, passwordHash, role: "user", mustChangePassword: false })
    .returning({ id: users.id });
  return c.json({ id: created[0].id }, 201);
});

admin.patch("/users/:id/status", async (c) => {
  const userId = Number(c.req.param("id"));
  const body = await readJsonBody(c.req.raw);
  if (!Number.isInteger(userId) || typeof body.isDisabled !== "boolean") {
    return c.json({ error: "请求参数不正确" }, 400);
  }
  if (userId === c.get("user").id) {
    return c.json({ error: "不能禁用当前管理员账号" }, 400);
  }

  const changed = await db
    .update(users)
    .set({ isDisabled: body.isDisabled })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (!changed.length) {
    return c.json({ error: "用户不存在" }, 404);
  }
  if (body.isDisabled) {
    await invalidateUserSessions(userId);
  }
  return c.body(null, 204);
});

admin.post("/users/:id/reset-password", async (c) => {
  const userId = Number(c.req.param("id"));
  const body = await readJsonBody(c.req.raw);
  const password = validatePassword(body.password);
  if (!Number.isInteger(userId)) {
    return c.json({ error: "用户不存在" }, 404);
  }

  const passwordHash = await Bun.password.hash(password, {
    algorithm: "argon2id",
  });
  const changed = await db
    .update(users)
    .set({ passwordHash, mustChangePassword: false })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (!changed.length) {
    return c.json({ error: "用户不存在" }, 404);
  }
  await invalidateUserSessions(userId);
  return c.body(null, 204);
});

export default admin;
