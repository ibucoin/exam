import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { db } from "../db/client";
import { sessions, users } from "../db/schema";
import {
  type AppEnv,
  createSession,
  requireAuth,
} from "../lib/auth";
import {
  readJsonBody,
  readString,
  validatePassword,
} from "../lib/validation";

const auth = new Hono<AppEnv>();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function loginKey(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function isRateLimited(key: string) {
  const now = Date.now();
  const attempt = loginAttempts.get(key);
  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return false;
  }
  attempt.count += 1;
  return attempt.count > 10;
}

auth.post("/login", async (c) => {
  const key = loginKey(c.req.raw);
  if (isRateLimited(key)) {
    return c.json({ error: "登录尝试过多，请稍后再试" }, 429);
  }

  const body = await readJsonBody(c.req.raw);
  const username = readString(body.username, "用户名");
  const password = typeof body.password === "string" ? body.password : "";
  const user = await db.query.users.findFirst({
    where: eq(users.username, username),
  });

  if (!user || user.isDisabled || !(await Bun.password.verify(password, user.passwordHash))) {
    return c.json({ error: "用户名或密码错误" }, 401);
  }

  loginAttempts.delete(key);
  await createSession(c, user.id);
  return c.json({
    id: user.id,
    username: user.username,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  });
});

auth.use("/me", requireAuth);
auth.get("/me", (c) => c.json(c.get("user")));

auth.use("/logout", requireAuth);
auth.post("/logout", async (c) => {
  await db.delete(sessions).where(eq(sessions.id, c.get("sessionId")));
  deleteCookie(c, "exam_session", { path: "/" });
  return c.body(null, 204);
});

auth.use("/change-password", requireAuth);
auth.post("/change-password", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = validatePassword(body.newPassword);
  const currentUser = c.get("user");
  const user = await db.query.users.findFirst({ where: eq(users.id, currentUser.id) });

  if (!user || !(await Bun.password.verify(currentPassword, user.passwordHash))) {
    return c.json({ error: "当前密码错误" }, 400);
  }
  if (currentPassword === newPassword) {
    return c.json({ error: "新密码不能与当前密码相同" }, 400);
  }

  const passwordHash = await Bun.password.hash(newPassword, {
    algorithm: "argon2id",
  });
  db.transaction((tx) => {
    tx
      .update(users)
      .set({ passwordHash, mustChangePassword: false })
      .where(eq(users.id, user.id))
      .run();
    tx.delete(sessions).where(eq(sessions.userId, user.id)).run();
  });
  deleteCookie(c, "exam_session", { path: "/" });
  return c.body(null, 204);
});

export default auth;
