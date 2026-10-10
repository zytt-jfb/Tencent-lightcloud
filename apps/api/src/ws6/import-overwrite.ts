export function importDiffRequiresOverwrite(
  diffSummary: Record<string, unknown> | null,
): boolean {
  if (!diffSummary) return false;
  const overwriteCount = Number(diffSummary.overwriteCount ?? 0);
  return Number.isFinite(overwriteCount) && overwriteCount > 0;
}
