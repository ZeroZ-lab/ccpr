import {
  calculateDrift,
  parseQualifiedPluginReference,
  type DomainError,
  type Drift,
  type InstalledState,
  type PluginReference,
  type ProjectManifest,
  type Result,
} from "./domain.js";

export interface StoreError {
  readonly kind: "store";
  readonly code:
    | "not_found"
    | "invalid_json"
    | "invalid_data"
    | "read_failed"
    | "write_failed";
  readonly subject: "manifest" | "profile";
  readonly path: string;
  readonly message: string;
}

export interface ClaudeCliError {
  readonly kind: "claude_cli";
  readonly code: "spawn_failed" | "command_failed" | "invalid_json" | "invalid_shape";
  readonly operation: "list" | "install";
  readonly message: string;
  readonly status?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface ManifestStore {
  exists(projectRoot: string): Result<boolean, StoreError>;
  read(projectRoot: string): Result<ProjectManifest, StoreError>;
  write(
    projectRoot: string,
    manifest: ProjectManifest,
  ): Result<void, StoreError>;
}

export interface ProfileStore {
  read(name: string): Result<ProjectManifest, StoreError>;
}

export interface ClaudePluginClient {
  listProject(projectRoot: string): Result<InstalledState, ClaudeCliError>;
  installProject(
    projectRoot: string,
    reference: PluginReference,
  ): Result<void, ClaudeCliError>;
}

export interface InspectProjectDependencies {
  readonly manifestStore: ManifestStore;
  readonly claudePluginClient: ClaudePluginClient;
}

export type InspectProjectError = StoreError | ClaudeCliError;

export interface InitializeProjectError {
  readonly kind: "init";
  readonly code: "manifest_exists";
  readonly message: string;
}

export type InitializeProjectResult = Result<
  ProjectManifest,
  StoreError | InitializeProjectError | DomainError
>;

function ensureProjectCanBeInitialized(
  projectRoot: string,
  manifestStore: ManifestStore,
  force: boolean,
): Result<void, StoreError | InitializeProjectError> {
  const exists = manifestStore.exists(projectRoot);
  if (!exists.ok) return exists;
  if (exists.value && !force) {
    return {
      ok: false,
      error: {
        kind: "init",
        code: "manifest_exists",
        message: ".ccx.json already exists. Re-run with --force to overwrite it.",
      },
    };
  }
  return { ok: true, value: undefined };
}

function writeInitializedProject(
  projectRoot: string,
  manifest: ProjectManifest,
  manifestStore: ManifestStore,
): InitializeProjectResult {
  const written = manifestStore.write(projectRoot, manifest);
  return written.ok ? { ok: true, value: manifest } : written;
}

export function initializeEmptyProject(
  projectRoot: string,
  manifestStore: ManifestStore,
  force = false,
): InitializeProjectResult {
  const allowed = ensureProjectCanBeInitialized(
    projectRoot,
    manifestStore,
    force,
  );
  if (!allowed.ok) return allowed;
  return writeInitializedProject(projectRoot, { plugins: [] }, manifestStore);
}

export function initializeProjectFromProfile(
  projectRoot: string,
  profileName: string,
  dependencies: {
    readonly manifestStore: ManifestStore;
    readonly profileStore: ProfileStore;
  },
  force = false,
): InitializeProjectResult {
  const allowed = ensureProjectCanBeInitialized(
    projectRoot,
    dependencies.manifestStore,
    force,
  );
  if (!allowed.ok) return allowed;

  const profile = dependencies.profileStore.read(profileName);
  if (!profile.ok) return profile;

  const plugins: PluginReference[] = [];
  const seen = new Set<PluginReference>();
  for (const candidate of profile.value.plugins) {
    const reference = parseQualifiedPluginReference(candidate);
    if (!reference.ok) return reference;
    if (!seen.has(reference.value)) {
      seen.add(reference.value);
      plugins.push(reference.value);
    }
  }

  return writeInitializedProject(
    projectRoot,
    { plugins },
    dependencies.manifestStore,
  );
}

export interface ImportPreview {
  readonly added: readonly PluginReference[];
  readonly removed: readonly PluginReference[];
  readonly manifest: ProjectManifest;
}

export function prepareProjectImport(
  projectRoot: string,
  dependencies: InspectProjectDependencies,
): Result<ImportPreview, InspectProjectError> {
  const current = dependencies.manifestStore.read(projectRoot);
  if (!current.ok && current.error.code !== "not_found") return current;

  const installed = dependencies.claudePluginClient.listProject(projectRoot);
  if (!installed.ok) return installed;

  const plugins = [...new Set(installed.value.plugins)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const currentPlugins = current.ok
    ? [...new Set(current.value.plugins)]
    : [];
  const currentSet = new Set(currentPlugins);
  const importedSet = new Set(plugins);

  return {
    ok: true,
    value: {
      added: plugins.filter((reference) => !currentSet.has(reference)),
      removed: currentPlugins.filter((reference) => !importedSet.has(reference)),
      manifest: { plugins },
    },
  };
}

export function commitProjectImport(
  projectRoot: string,
  preview: ImportPreview,
  manifestStore: ManifestStore,
): Result<void, StoreError> {
  return manifestStore.write(projectRoot, preview.manifest);
}

export interface ApplyReport {
  readonly drift: Drift;
  readonly installed: readonly PluginReference[];
  readonly failed: readonly {
    readonly reference: PluginReference;
    readonly error: ClaudeCliError;
  }[];
}

export type ApplyError =
  | {
      readonly kind: "apply";
      readonly code: "partial_failure";
      readonly message: string;
      readonly report: ApplyReport;
    }
  | {
      readonly kind: "apply";
      readonly code: "unqualified_plugin_reference";
      readonly message: string;
      readonly reference: PluginReference;
    };

export type ApplyProjectError = InspectProjectError | ApplyError;

export function inspectProject(
  projectRoot: string,
  dependencies: InspectProjectDependencies,
): Result<Drift, InspectProjectError> {
  const manifest = dependencies.manifestStore.read(projectRoot);
  if (!manifest.ok) return manifest;

  const installed = dependencies.claudePluginClient.listProject(projectRoot);
  if (!installed.ok) return installed;

  return {
    ok: true,
    value: calculateDrift(manifest.value, installed.value),
  };
}

export function applyProject(
  projectRoot: string,
  dependencies: InspectProjectDependencies,
): Result<ApplyReport, ApplyProjectError> {
  const inspection = inspectProject(projectRoot, dependencies);
  if (!inspection.ok) return inspection;

  for (const reference of inspection.value.missing) {
    if (!parseQualifiedPluginReference(reference).ok) {
      return {
        ok: false,
        error: {
          kind: "apply",
          code: "unqualified_plugin_reference",
          message: `Cannot apply unqualified Plugin Reference ${JSON.stringify(reference)}. Update .ccx.json to use plugin-name@marketplace-name, then run \`ccx project up\` again.`,
          reference,
        },
      };
    }
  }

  const installed = [];
  const failed = [];
  for (const reference of inspection.value.missing) {
    const installation = dependencies.claudePluginClient.installProject(
      projectRoot,
      reference,
    );
    if (installation.ok) installed.push(reference);
    else failed.push({ reference, error: installation.error });
  }

  const report = { drift: inspection.value, installed, failed };
  if (failed.length > 0) {
    return {
      ok: false,
      error: {
        kind: "apply",
        code: "partial_failure",
        message: `${failed.length} plugin installation(s) failed.`,
        report,
      },
    };
  }

  return { ok: true, value: report };
}
