import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(__dirname, "index.ts");

describe("server startup", () => {
  it("does not initialize database schema automatically", () => {
    const source = fs.readFileSync(indexPath, "utf-8");

    expect(source).not.toContain("initDb");
    expect(source).not.toContain("initDbSchema");
    expect(source).toContain("checkDbConnection");
  });
});
