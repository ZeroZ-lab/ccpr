import {
  calculateDrift,
  type Drift,
  type InstalledState,
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
  readonly operation: "list";
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
}

export interface InspectProjectDependencies {
  readonly manifestStore: ManifestStore;
  readonly claudePluginClient: ClaudePluginClient;
}

export type InspectProjectError = StoreError | ClaudeCliError;

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
