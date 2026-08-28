import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./server/db/app-schema.ts",
  out: "./drizzle",
});
