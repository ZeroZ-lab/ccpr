import {
  calculateDrift,
  parseQualifiedPluginReference,
  type Drift,
  type InstalledState,
  type PluginReference,
  type ProjectManifest,
  type Result,
} from "./domain.js";

export interface StoreError {
  readonly kind: "store";
  readonly code: "not_found" | "invalid_json" | "invalid_data" | "read_failed";
  readonly subject: "manifest";
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
  read(projectRoot: string): Result<ProjectManifest, StoreError>;
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
