export const protectedPlanningMessage = "当前项目已有生成图片或历史版本，为保护已有成果，不能整页重新规划。请编辑现有模块，或新建项目重新规划。";

export function normalizeGenerationRequirements(value: unknown) {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
}

export function getPlanningRequirementsSync(snapshot: unknown, requirements: string, hasSections: boolean) {
  if (!hasSections) return "unplanned";
  const recorded = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? (snapshot as Record<string, unknown>).plannedGenerationRequirements
    : undefined;
  if (typeof recorded !== "string") return "unknown";
  return normalizeGenerationRequirements(recorded) === normalizeGenerationRequirements(requirements) ? "synced" : "outdated";
}
