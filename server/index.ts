import app from "./app";
import { initializeDatabase } from "./db/initialize";

await initializeDatabase();

const port = Number(process.env.PORT ?? 18002);

Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`服务已启动：http://localhost:${port}`);
