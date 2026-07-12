import type {
  ApplyError,
  ApplyProjectError,
  ApplyReport,
  CatalogPlugin,
  ImportPreview,
  InitializeProjectResult,
  InspectProjectError,
  ProfileActionResult,
  ProfileSummary,
  StoreError,
} from "./application.js";
import type { Drift, ProjectManifest, Result } from "./domain.js";

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

export interface ProfileCommandPresentation {
  readonly create: (
    name: string,
    fromProject: boolean,
  ) => ProfileActionResult<ProjectManifest>;
  readonly list: () => Result<readonly ProfileSummary[], StoreError>;
  readonly inspect: (name: string) => Result<ProjectManifest, StoreError>;
  readonly update: (
    name: string,
    change: { readonly kind: "add" | "remove"; readonly reference: string },
  ) => ProfileActionResult<ProjectManifest>;
  readonly remove: (name: string) => Result<void, StoreError>;
  readonly writeStdout: (output: string) => void;
  readonly writeStderr: (output: string) => void;
}

export interface PluginCommandPresentation {
  readonly list: () => Result<readonly CatalogPlugin[], StoreError>;
  readonly search: (
    keyword: string,
  ) => Result<readonly CatalogPlugin[], StoreError>;
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

function renderCatalog(plugins: readonly CatalogPlugin[]): string {
  if (plugins.length === 0) return "No plugins found.\n";
  return `${plugins.map((plugin) => {
    const details = [plugin.category, plugin.description]
      .filter(Boolean)
      .join(" — ");
    return details ? `${plugin.reference}  ${details}` : plugin.reference;
  }).join("\n")}\n`;
}

export function routeProfileCommand(
  args: readonly string[],
  presentation: ProfileCommandPresentation,
): number | undefined {
  if (args[0] !== "profile") return undefined;

  const action = args[1];
  if (action === "create") {
    const fromProject = args[2] === "--from-project";
    const name = fromProject ? args[3] : args[2];
    const valid = Boolean(name) && args.length === (fromProject ? 4 : 3);
    if (!valid) {
      presentation.writeStderr(
        "Usage: ccx profile create [--from-project] NAME\n",
      );
      return 1;
    }
    const created = presentation.create(name, fromProject);
    if (!created.ok) {
      presentation.writeStderr(`${created.error.message}\n`);
      return 1;
    }
    presentation.writeStdout(
      `Created profile ${JSON.stringify(name)} with ${created.value.plugins.length} plugins.\n`,
    );
    return 0;
  }

  if (action === "ls" && args.length === 2) {
    const profiles = presentation.list();
    if (!profiles.ok) {
      presentation.writeStderr(`${profiles.error.message}\n`);
      return 1;
    }
    presentation.writeStdout(
      profiles.value.length === 0
        ? "No profiles found.\n"
        : `${profiles.value.map(({ name, pluginCount }) =>
          `${name}  (${pluginCount} plugins)`
        ).join("\n")}\n`,
    );
    return 0;
  }

  if (action === "inspect" && args.length === 3) {
    const profile = presentation.inspect(args[2]);
    if (!profile.ok) {
      presentation.writeStderr(`${profile.error.message}\n`);
      return 1;
    }
    presentation.writeStdout(
      profile.value.plugins.length === 0
        ? "(empty)\n"
        : `${profile.value.plugins.join("\n")}\n`,
    );
    return 0;
  }

  if (
    action === "update" &&
    args.length === 5 &&
    (args[2] === "--add" || args[2] === "--remove")
  ) {
    const kind = args[2] === "--add" ? "add" : "remove";
    const updated = presentation.update(args[4], {
      kind,
      reference: args[3],
    });
    if (!updated.ok) {
      presentation.writeStderr(`${updated.error.message}\n`);
      return 1;
    }
    presentation.writeStdout(
      `${kind === "add" ? "Added" : "Removed"} ${JSON.stringify(args[3])} ${kind === "add" ? "to" : "from"} profile ${JSON.stringify(args[4])}.\n`,
    );
    return 0;
  }

  if (action === "rm" && args.length === 3) {
    const removed = presentation.remove(args[2]);
    if (!removed.ok) {
      presentation.writeStderr(`${removed.error.message}\n`);
      return 1;
    }
    presentation.writeStdout(`Removed profile ${JSON.stringify(args[2])}.\n`);
    return 0;
  }

  presentation.writeStderr(
    "Usage: ccx profile <create|ls|inspect|update|rm> ...\n",
  );
  return 1;
}

export function routePluginCommand(
  args: readonly string[],
  presentation: PluginCommandPresentation,
): number | undefined {
  if (args[0] !== "plugin") return undefined;

  let plugins: Result<readonly CatalogPlugin[], StoreError>;
  if (args[1] === "ls" && args.length === 2) {
    plugins = presentation.list();
  } else if (args[1] === "search" && args.length === 3) {
    plugins = presentation.search(args[2]);
  } else {
    presentation.writeStderr("Usage: ccx plugin <ls | search KEYWORD>\n");
    return 1;
  }

  if (!plugins.ok) {
    presentation.writeStderr(`${plugins.error.message}\n`);
    return 1;
  }
  presentation.writeStdout(renderCatalog(plugins.value));
  return 0;
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
