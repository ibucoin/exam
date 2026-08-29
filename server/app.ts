import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { secureHeaders } from "hono/secure-headers";
import admin from "./routes/admin";
import auth from "./routes/auth";
import study from "./routes/study";
import { ValidationError } from "./lib/validation";

const app = new Hono();

app.use("*", secureHeaders());
app.get("/api/health", (c) => c.json({ status: "ok" }));
app.route("/api/auth", auth);
app.route("/api/admin", admin);
app.route("/api", study);
app.all("/api/*", (c) => c.json({ error: "接口不存在" }, 404));

app.use("/*", serveStatic({ root: "./dist" }));
app.get("*", async (c) => {
  const index = Bun.file("./dist/index.html");
  if (await index.exists()) {
    return new Response(index, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return c.json({ error: "页面资源尚未构建" }, 404);
});

app.onError((error, c) => {
  if (error instanceof ValidationError) {
    return c.json({ error: error.message }, 400);
  }
  console.error(error);
  return c.json({ error: "服务器处理请求失败" }, 500);
});

export default app;
