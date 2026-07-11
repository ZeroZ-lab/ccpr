import type {
  ApplyError,
  ApplyProjectError,
  ApplyReport,
  InspectProjectError,
} from "./application.js";
import type { Drift, Result } from "./domain.js";

export interface ProjectDiffPresentation {
  readonly projectRoot: string;
  readonly inspect: (
    projectRoot: string,
  ) => Result<Drift, InspectProjectError>;
  readonly writeStdout: (output: string) => void;
  readonly writeStderr: (output: string) => void;
}

export interface ProjectUpPresentation {
  readonly projectRoot: string;
  readonly apply: (
    projectRoot: string,
  ) => Result<ApplyReport, ApplyProjectError>;
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

function renderApplyReport(report: ApplyReport): string {
  return `${renderDrift(report.drift)}${renderGroup(
    "Installed",
    report.installed,
  )}\n${renderGroup(
    "Failed",
    report.failed.map(({ reference }) => reference),
  )}\n`;
}

function renderApplyError(error: ApplyError): string {
  if (error.code === "unqualified_plugin_reference") {
    return `${error.message}\n`;
  }

  const sections = error.report.failed.map(({ reference, error: cause }) => {
    const lines = [`Failed ${reference}:`, `  ${cause.message}`];
    if (cause.stderr?.trim()) lines.push(`  ${cause.stderr.trim()}`);
    if (cause.stdout?.trim()) lines.push(`  ${cause.stdout.trim()}`);
    return lines.join("\n");
  });
  return `${sections.join("\n")}\n`;
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

export function routeProjectUp(
  args: readonly string[],
  presentation: ProjectUpPresentation,
): number | undefined {
  const isAlias = args[0] === "up";
  const isCanonical = args[0] === "project" && args[1] === "up";
  if (!isAlias && !isCanonical) return undefined;

  if ((isAlias && args.length !== 1) || (isCanonical && args.length !== 2)) {
    presentation.writeStderr("Usage: ccx project up\n");
    return 1;
  }

  const apply = presentation.apply(presentation.projectRoot);
  if (!apply.ok) {
    if (apply.error.kind === "apply") {
      if (apply.error.code === "partial_failure") {
        presentation.writeStdout(renderApplyReport(apply.error.report));
      }
      presentation.writeStderr(renderApplyError(apply.error));
    } else {
      presentation.writeStderr(renderInspectionError(apply.error));
    }
    return 1;
  }

  presentation.writeStdout(renderApplyReport(apply.value));
  return 0;
}
