export type DetailTab = "agent" | "rubric" | "skills" | "versions" | "report" | "optimization" | "diff";

export function getDefaultDetailTab(): DetailTab {
  return "report";
}
