import { copyFile } from "node:fs/promises";
import { Database } from "bun:sqlite";

const [sourcePath, targetPath] = Bun.argv.slice(2);

if (!sourcePath || !targetPath) {
  throw new Error("用法：bun scripts/create-seed.ts <源数据库> <目标数据库>");
}

await copyFile(sourcePath, targetPath);

const database = new Database(targetPath);
database.exec("PRAGMA foreign_keys = ON");
database.transaction(() => {
  database.exec("DELETE FROM users");
  database
    .query(
      "DELETE FROM sqlite_sequence WHERE name IN ('users', 'attempts', 'validation_rounds', 'validation_round_items', 'fsrs_review_logs')",
    )
    .run();
})();
database.exec("VACUUM");
database.close();
