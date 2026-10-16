import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureSkillRoot } from "./paths.js";
import { createReadSkillFileTool } from "./read-skill-file-tool.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("read_skill_file", () => {
  it("reads an allowed UTF-8 Markdown reference", async () => {
    const handle = createReadSkillFileTool(fixtureSkillRoot());
    const result = await handle.tool.execute("call-1", { path: "references/fact.md" });
    expect(result.content[0]?.type).toBe("text");
    expect(handle.getAudit()).toMatchObject({ readCount: 1, deniedCount: 0 });
  });

  it.each(["../outside.md", "C:\\outside.md", "references/fact.txt"])(
    "rejects invalid access to %s",
    async (path) => {
      const handle = createReadSkillFileTool(fixtureSkillRoot());
      await expect(handle.tool.execute("call-2", { path })).rejects.toThrow("TOOL_DENIED");
      expect(handle.getAudit().deniedCount).toBe(1);
    },
  );

  it("rejects oversized files and releases the temporary fixture", async () => {
    const root = await mkdtemp(join(tmpdir(), "edu-pi-tool-"));
    temporaryRoots.push(root);
    await writeFile(join(root, "large.md"), "x".repeat(65));
    const handle = createReadSkillFileTool(root, { maxFileBytes: 64 });
    await expect(handle.tool.execute("call-3", { path: "large.md" })).rejects.toThrow(
      "TOOL_DENIED: file is too large",
    );
  });

  it("honors an already aborted signal", async () => {
    const handle = createReadSkillFileTool(fixtureSkillRoot());
    const controller = new AbortController();
    controller.abort();
    await expect(
      handle.tool.execute("call-4", { path: "references/fact.md" }, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
