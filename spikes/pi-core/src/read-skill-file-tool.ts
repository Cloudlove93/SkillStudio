import { realpath, readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolAudit } from "./types.js";

const DEFAULT_MAX_FILE_BYTES = 64 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024;
const DEFAULT_MAX_READS = 8;
const parameters = Type.Object(
  { path: Type.String({ minLength: 1, maxLength: 240 }) },
  { additionalProperties: false },
);

interface ReadDetails {
  bytes: number;
  relativePath: string;
}

export interface ReadSkillFileToolHandle {
  tool: AgentTool<typeof parameters, ReadDetails>;
  getAudit(): ToolAudit;
}

function abortError(): Error {
  const error = new Error("Tool execution was aborted");
  error.name = "AbortError";
  return error;
}

function validateRelativePath(input: string): string {
  if (input.includes("\0") || isAbsolute(input)) {
    throw new Error("TOOL_DENIED: path must be relative");
  }
  const normalized = input.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("TOOL_DENIED: invalid path segment");
  }
  if (extname(normalized).toLowerCase() !== ".md") {
    throw new Error("TOOL_DENIED: only Markdown resources are readable");
  }
  return normalized;
}

async function resolveContainedFile(root: string, input: string): Promise<string> {
  const rootPath = await realpath(root);
  const candidate = await realpath(resolve(rootPath, input));
  const relativePath = relative(rootPath, candidate);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("TOOL_DENIED: resource escapes the Skill root");
  }
  const metadata = await stat(candidate);
  if (!metadata.isFile()) {
    throw new Error("TOOL_DENIED: resource is not a regular file");
  }
  return candidate;
}

export function createReadSkillFileTool(
  skillRoot: string,
  limits: {
    maxFileBytes?: number;
    maxTotalBytes?: number;
    maxReads?: number;
  } = {},
): ReadSkillFileToolHandle {
  const audit: ToolAudit = { readCount: 0, totalBytes: 0, deniedCount: 0 };
  const maxFileBytes = limits.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = limits.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const maxReads = limits.maxReads ?? DEFAULT_MAX_READS;
  const tool: AgentTool<typeof parameters, ReadDetails> = {
    name: "read_skill_file",
    label: "Read Skill file",
    description: "Read one UTF-8 Markdown file inside the fixed Skill directory.",
    parameters,
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal) => {
      try {
        if (signal?.aborted) throw abortError();
        const relativePath = validateRelativePath(params.path);
        const filePath = await resolveContainedFile(skillRoot, relativePath);
        const metadata = await stat(filePath);
        if (metadata.size > maxFileBytes) throw new Error("TOOL_DENIED: file is too large");
        if (audit.readCount >= maxReads) throw new Error("TOOL_DENIED: read limit exceeded");
        if (audit.totalBytes + metadata.size > maxTotalBytes) {
          throw new Error("TOOL_DENIED: total read limit exceeded");
        }
        const bytes = await readFile(filePath);
        if (signal?.aborted) throw abortError();
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        audit.readCount += 1;
        audit.totalBytes += bytes.byteLength;
        return {
          content: [{ type: "text", text }],
          details: { bytes: bytes.byteLength, relativePath },
        };
      } catch (error) {
        audit.deniedCount += 1;
        throw error;
      }
    },
  };
  return { tool, getAudit: () => ({ ...audit }) };
}
