import { and, eq, gt } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { CurrentUser } from "../../shared/types";
import { db } from "../db/client";
import { sessions, users } from "../db/schema";

const SESSION_COOKIE = "exam_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_MS = 24 * 60 * 60 * 1000;

export interface AppEnv {
  Variables: {
    user: CurrentUser;
    sessionId: string;
  };
}

function sessionHash(token: string) {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function createSession(
  c: Parameters<typeof setCookie>[0],
  userId: number,
) {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64url",
  );
  const now = Date.now();
  await db.insert(sessions).values({
    id: sessionHash(token),
    userId,
    expiresAt: now + SESSION_TTL_MS,
    lastSeenAt: now,
    createdAt: now,
  });
  setSessionCookie(c, token);
}

export function clearSessionCookie(c: Parameters<typeof deleteCookie>[0]) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    return c.json({ error: "请先登录" }, 401);
  }

  const now = Date.now();
  const sessionId = sessionHash(token);
  const result = await db
    .select({
      sessionUserId: sessions.userId,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      id: users.id,
      username: users.username,
      role: users.role,
      mustChangePassword: users.mustChangePassword,
      isDisabled: users.isDisabled,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
    .limit(1);

  const row = result[0];
  if (!row || row.isDisabled) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    clearSessionCookie(c);
    return c.json({ error: "登录已失效" }, 401);
  }

  if (now - row.lastSeenAt >= SESSION_REFRESH_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: now + SESSION_TTL_MS })
      .where(eq(sessions.id, sessionId));
    setSessionCookie(c, token);
  }

  c.set("sessionId", sessionId);
  c.set("user", {
    id: row.id,
    username: row.username,
    role: row.role,
    mustChangePassword: row.mustChangePassword,
  });
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("user").role !== "admin") {
    return c.json({ error: "无权执行此操作" }, 403);
  }
  await next();
});

export async function invalidateUserSessions(userId: number) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
