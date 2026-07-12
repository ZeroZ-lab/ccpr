import {
  calculateDrift,
  parseQualifiedPluginReference,
  parseReadablePluginReference,
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
  readonly subject: "manifest" | "profile" | "catalog";
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
  exists(name: string): Result<boolean, StoreError>;
  list(): Result<readonly string[], StoreError>;
  read(name: string): Result<ProjectManifest, StoreError>;
  write(name: string, manifest: ProjectManifest): Result<void, StoreError>;
  remove(name: string): Result<void, StoreError>;
}

export interface CatalogPlugin {
  readonly reference: PluginReference;
  readonly description: string;
  readonly category?: string;
  readonly marketplace: string;
}

export interface MarketplaceCatalogStore {
  list(): Result<readonly CatalogPlugin[], StoreError>;
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

  const normalized = normalizeQualifiedReferences(profile.value.plugins);
  if (!normalized.ok) return normalized;

  return writeInitializedProject(
    projectRoot,
    { plugins: normalized.value },
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

  const plugins = [...new Set(installed.value.plugins)];
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

export interface ManifestActionError {
  readonly kind: "manifest";
  readonly code: "plugin_not_found";
  readonly message: string;
}

export function updateProjectManifest(
  projectRoot: string,
  change: { readonly kind: "add" | "remove"; readonly reference: string },
  manifestStore: ManifestStore,
): Result<ProjectManifest, StoreError | DomainError | ManifestActionError> {
  const manifest = manifestStore.read(projectRoot);
  if (!manifest.ok) return manifest;

  const parsed = change.kind === "add"
    ? parseQualifiedPluginReference(change.reference)
    : parseReadablePluginReference(change.reference);
  if (!parsed.ok) return parsed;

  const plugins = [...manifest.value.plugins];
  const index = plugins.indexOf(parsed.value);
  if (change.kind === "add") {
    if (index === -1) plugins.push(parsed.value);
  } else if (index === -1) {
    return {
      ok: false,
      error: {
        kind: "manifest",
        code: "plugin_not_found",
        message: `Plugin ${JSON.stringify(change.reference)} not found in .ccx.json.`,
      },
    };
  } else {
    plugins.splice(index, 1);
  }

  const updated = { plugins };
  const written = manifestStore.write(projectRoot, updated);
  return written.ok ? { ok: true, value: updated } : written;
}

export interface ProfileActionError {
  readonly kind: "profile";
  readonly code: "already_exists" | "plugin_not_found";
  readonly message: string;
}

export type ProfileActionResult<T> = Result<
  T,
  StoreError | DomainError | ProfileActionError
>;

function normalizeQualifiedReferences(
  candidates: readonly PluginReference[],
): Result<readonly PluginReference[], DomainError> {
  const plugins: PluginReference[] = [];
  const seen = new Set<PluginReference>();
  for (const candidate of candidates) {
    const reference = parseQualifiedPluginReference(candidate);
    if (!reference.ok) return reference;
    if (!seen.has(reference.value)) {
      seen.add(reference.value);
      plugins.push(reference.value);
    }
  }
  return { ok: true, value: plugins };
}

export function createProfile(
  name: string,
  source: { readonly kind: "empty" } | {
    readonly kind: "project";
    readonly projectRoot: string;
    readonly manifestStore: ManifestStore;
  },
  profileStore: ProfileStore,
): ProfileActionResult<ProjectManifest> {
  const exists = profileStore.exists(name);
  if (!exists.ok) return exists;
  if (exists.value) {
    return {
      ok: false,
      error: {
        kind: "profile",
        code: "already_exists",
        message: `Profile ${JSON.stringify(name)} already exists.`,
      },
    };
  }

  let sourceManifest: ProjectManifest;
  if (source.kind === "empty") {
    sourceManifest = { plugins: [] };
  } else {
    const manifest = source.manifestStore.read(source.projectRoot);
    if (!manifest.ok) return manifest;
    sourceManifest = manifest.value;
  }
  const normalized = normalizeQualifiedReferences(sourceManifest.plugins);
  if (!normalized.ok) return normalized;

  const profile = { plugins: normalized.value };
  const written = profileStore.write(name, profile);
  return written.ok ? { ok: true, value: profile } : written;
}

export interface ProfileSummary {
  readonly name: string;
  readonly pluginCount: number;
}

export function listProfileSummaries(
  profileStore: ProfileStore,
): Result<readonly ProfileSummary[], StoreError> {
  const names = profileStore.list();
  if (!names.ok) return names;

  const summaries: ProfileSummary[] = [];
  for (const name of names.value) {
    const profile = profileStore.read(name);
    if (!profile.ok) return profile;
    summaries.push({ name, pluginCount: profile.value.plugins.length });
  }
  return { ok: true, value: summaries };
}

export function updateProfile(
  name: string,
  change: { readonly kind: "add" | "remove"; readonly reference: string },
  profileStore: ProfileStore,
): ProfileActionResult<ProjectManifest> {
  const profile = profileStore.read(name);
  if (!profile.ok) return profile;

  const parsed = change.kind === "add"
    ? parseQualifiedPluginReference(change.reference)
    : parseReadablePluginReference(change.reference);
  if (!parsed.ok) return parsed;

  const plugins = [...profile.value.plugins];
  const index = plugins.indexOf(parsed.value);
  if (change.kind === "add") {
    if (index === -1) plugins.push(parsed.value);
  } else if (index === -1) {
    return {
      ok: false,
      error: {
        kind: "profile",
        code: "plugin_not_found",
        message: `Plugin ${JSON.stringify(change.reference)} not found in profile ${JSON.stringify(name)}.`,
      },
    };
  } else {
    plugins.splice(index, 1);
  }

  const updated = { plugins };
  const written = profileStore.write(name, updated);
  return written.ok ? { ok: true, value: updated } : written;
}

export function removeProfileTemplate(
  name: string,
  profileStore: ProfileStore,
): Result<void, StoreError> {
  return profileStore.remove(name);
}

export function listCatalogPlugins(
  catalogStore: MarketplaceCatalogStore,
): Result<readonly CatalogPlugin[], StoreError> {
  return catalogStore.list();
}

export function searchCatalogPlugins(
  keyword: string,
  catalogStore: MarketplaceCatalogStore,
): Result<readonly CatalogPlugin[], StoreError> {
  const catalog = catalogStore.list();
  if (!catalog.ok) return catalog;
  const query = keyword.trim().toLowerCase();
  return {
    ok: true,
    value: catalog.value.filter((plugin) =>
      plugin.reference.toLowerCase().includes(query) ||
      plugin.description.toLowerCase().includes(query) ||
      (plugin.category || "").toLowerCase().includes(query)
    ),
  };
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
