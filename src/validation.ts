import type { StructuredSummary } from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isSummary(value: unknown): value is StructuredSummary {
  return (
    isRecord(value) &&
    ["goals", "facts", "decisions", "constraints", "openQuestions"].every((key) =>
      isStringArray(value[key])
    ) &&
    Number.isSafeInteger(value.compressedAt) &&
    (value.compressedAt as number) >= 0
  );
}

export function isDomain(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value) &&
    !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(value)
  );
}
