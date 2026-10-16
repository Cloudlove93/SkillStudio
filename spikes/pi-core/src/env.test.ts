import { afterEach, describe, expect, it, vi } from "vitest";
const { readEnvMock } = vi.hoisted(() => ({ readEnvMock: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: readEnvMock }));
import { loadEduclawLlmEnvironment } from "./env.js";

afterEach(() => {
  vi.unstubAllEnvs();
  readEnvMock.mockReset();
});
function setup(files: Record<string, string>) {
  for (const name of ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL"]) vi.stubEnv(name, undefined);
  readEnvMock.mockImplementation(async (path: string) => {
    const name = path.replaceAll("\\", "/").split("/").at(-1)!;
    if (name in files) return files[name];
    throw Object.assign(new Error("fixture file absent"), { code: "ENOENT" });
  });
}
describe("Spike trusted configuration precedence", () => {
  it("uses local overrides before the root environment, matching the server", async () => {
    setup({ ".env.local": "LLM_API_KEY=fake-local-key\nLLM_BASE_URL=https://local-provider.invalid/v1\n", ".env": "LLM_API_KEY=fake-root-key\nLLM_MODEL=fixture-model\n" });
    await loadEduclawLlmEnvironment();
    expect(process.env.LLM_API_KEY === "fake-local-key").toBe(true);
    expect(process.env.LLM_BASE_URL).toBe("https://local-provider.invalid/v1");
    expect(process.env.LLM_MODEL).toBe("fixture-model");
  });
  it("honors explicit process settings without requiring environment files", async () => {
    setup({});
    vi.stubEnv("LLM_API_KEY", "fake-process-key"); vi.stubEnv("LLM_BASE_URL", "https://process-provider.invalid/v1"); vi.stubEnv("LLM_MODEL", "process-model");
    await loadEduclawLlmEnvironment();
    expect(process.env.LLM_API_KEY === "fake-process-key").toBe(true);
    expect(process.env.LLM_MODEL).toBe("process-model");
  });
});
