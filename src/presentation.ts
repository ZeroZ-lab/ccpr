import type { InspectProjectError } from "./application.js";
import type { Drift, Result } from "./domain.js";

export interface ProjectDiffPresentation {
  readonly projectRoot: string;
  readonly inspect: (
    projectRoot: string,
  ) => Result<Drift, InspectProjectError>;
  readonly writeStdout: (output: string) => void;
  readonly writeStderr: (output: string) => void;
}

function renderGroup(label: string, references: readonly string[]): string {
  return `${label}:\n${
    references.length === 0
      ? "  (none)"
      : references.map((reference) => `  ${reference}`).join("\n")
  }`;
}

function renderDrift(drift: Drift): string {
  return `${renderGroup("Missing", drift.missing)}\n${renderGroup(
    "Undeclared",
    drift.undeclared,
  )}\n`;
}

function renderInspectionError(error: InspectProjectError): string {
  const lines = [error.message];
  if (error.kind === "claude_cli") {
    if (error.stderr?.trim()) lines.push(error.stderr.trim());
    if (error.stdout?.trim()) lines.push(error.stdout.trim());
  }
  return `${lines.join("\n")}\n`;
}

export function routeProjectDiff(
  args: readonly string[],
  presentation: ProjectDiffPresentation,
): number | undefined {
  const isAlias = args[0] === "diff";
  const isCanonical = args[0] === "project" && args[1] === "diff";
  if (!isAlias && !isCanonical) return undefined;

  if ((isAlias && args.length !== 1) || (isCanonical && args.length !== 2)) {
    presentation.writeStderr("Usage: ccx project diff\n");
    return 1;
  }

  const inspection = presentation.inspect(presentation.projectRoot);
  if (!inspection.ok) {
    presentation.writeStderr(renderInspectionError(inspection.error));
    return 1;
  }

  presentation.writeStdout(renderDrift(inspection.value));
  return inspection.value.missing.length > 0 ||
    inspection.value.undeclared.length > 0
    ? 2
    : 0;
}
