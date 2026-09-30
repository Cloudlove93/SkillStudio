import type { ArenaReport } from "@educlaw/shared";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isArenaDimensionScore(value: unknown): boolean {
  return isRecord(value)
    && typeof value.key === "string"
    && typeof value.name === "string"
    && typeof value.score === "number"
    && Number.isFinite(value.score)
    && typeof value.maxScore === "number"
    && Number.isFinite(value.maxScore)
    && typeof value.reason === "string";
}

function isArenaReportSide(value: unknown): boolean {
  return isRecord(value)
    && typeof value.summary === "string"
    && typeof value.total === "number"
    && Number.isFinite(value.total)
    && Array.isArray(value.dimensions)
    && value.dimensions.every(isArenaDimensionScore);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isArenaReport(value: unknown): value is ArenaReport {
  return isRecord(value)
    && isFiniteNumber(value.threadId)
    && isArenaReportSide(value.baseline)
    && isArenaReportSide(value.enhanced)
    && typeof value.recommendation === "string"
    && (value.winningSide === "baseline" || value.winningSide === "enhanced" || value.winningSide === "tie");
}

export function parseStoredArenaReport(raw: string): ArenaReport | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isArenaReport(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
