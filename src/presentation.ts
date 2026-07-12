import type {
  ApplyError,
  ApplyProjectError,
  ApplyReport,
  ImportPreview,
  InitializeProjectResult,
  InspectProjectError,
  StoreError,
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

export interface ProjectInitPresentation {
  readonly initializeEmpty: (force: boolean) => InitializeProjectResult;
  readonly initializeFromProfile: (
    profileName: string,
    force: boolean,
  ) => InitializeProjectResult;
  readonly writeStdout: (output: string) => void;
  readonly writeStderr: (output: string) => void;
}

export interface ProjectImportPresentation {
  readonly projectRoot: string;
  readonly prepare: (
    projectRoot: string,
  ) => Result<ImportPreview, InspectProjectError>;
  readonly commit: (
    projectRoot: string,
    preview: ImportPreview,
  ) => Result<void, StoreError>;
  readonly isInteractive: boolean;
  readonly confirm?: (preview: ImportPreview) => boolean;
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

export function routeProjectInit(
  args: readonly string[],
  presentation: ProjectInitPresentation,
): number | undefined {
  const isAlias = args[0] === "init";
  const isCanonical = args[0] === "project" && args[1] === "init";
  if (!isAlias && !isCanonical) return undefined;

  const options = args.slice(isAlias ? 1 : 2);
  const isEmpty =
    options[0] === "--empty" &&
    (options.length === 1 ||
      (options.length === 2 && options[1] === "--force"));
  const isFromProfile =
    options[0] === "--from-profile" &&
    Boolean(options[1]) &&
    (options.length === 2 ||
      (options.length === 3 && options[2] === "--force"));
  if (!isEmpty && !isFromProfile) {
    presentation.writeStderr(
      "Usage: ccx project init (--empty | --from-profile PROFILE) [--force]\n",
    );
    return 1;
  }

  const force = options.at(-1) === "--force";
  const initialized = isEmpty
    ? presentation.initializeEmpty(force)
    : presentation.initializeFromProfile(options[1], force);
  if (!initialized.ok) {
    presentation.writeStderr(`${initialized.error.message}\n`);
    return 1;
  }

  presentation.writeStdout(
    `Created .ccx.json with ${initialized.value.plugins.length} plugins.\n`,
  );
  return 0;
}

export function routeProjectImport(
  args: readonly string[],
  presentation: ProjectImportPresentation,
): number | undefined {
  const isCanonical = args[0] === "project" && args[1] === "import";
  if (!isCanonical) return undefined;

  if (
    args.length > 3 ||
    (args.length === 3 && args[2] !== "--yes")
  ) {
    presentation.writeStderr("Usage: ccx project import [--yes]\n");
    return 1;
  }

  const prepared = presentation.prepare(presentation.projectRoot);
  if (!prepared.ok) {
    presentation.writeStderr(renderInspectionError(prepared.error));
    return 1;
  }

  presentation.writeStdout(
    `${renderGroup("Added", prepared.value.added)}\n${renderGroup(
      "Removed",
      prepared.value.removed,
    )}\n`,
  );

  let approved = args[2] === "--yes";
  if (!approved && presentation.isInteractive && presentation.confirm) {
    approved = presentation.confirm(prepared.value);
    if (!approved) return 0;
  }
  if (!approved) {
    presentation.writeStderr(
      "Non-interactive project import requires --yes; no changes were written.\n",
    );
    return 1;
  }

  const committed = presentation.commit(
    presentation.projectRoot,
    prepared.value,
  );
  if (!committed.ok) {
    presentation.writeStderr(`${committed.error.message}\n`);
    return 1;
  }

  presentation.writeStdout(
    `Imported .ccx.json with ${prepared.value.manifest.plugins.length} plugins.\n`,
  );
  return 0;
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
