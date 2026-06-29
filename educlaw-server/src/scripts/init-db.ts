import { closeDbPool } from "../services/db.js";
import { initDbSchema } from "../services/db-schema.js";

try {
  await initDbSchema();
  console.log("database schema initialized");
} catch (error) {
  console.error("database schema initialization failed", error);
  process.exitCode = 1;
} finally {
  await closeDbPool();
}
