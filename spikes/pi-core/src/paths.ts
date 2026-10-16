import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function fixtureSkillRoot(): string {
  const sourceDir = dirname(fileURLToPath(import.meta.url));
  return resolve(sourceDir, "../fixtures/reference-skill");
}
