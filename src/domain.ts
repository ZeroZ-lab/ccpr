export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

declare const pluginReferenceBrand: unique symbol;

export type PluginReference = string & {
  readonly [pluginReferenceBrand]: true;
};

export interface ProjectManifest {
  readonly plugins: readonly PluginReference[];
}

export interface InstalledState {
  readonly projectRoot: string;
  readonly plugins: readonly PluginReference[];
}

export interface Drift {
  readonly missing: readonly PluginReference[];
  readonly undeclared: readonly PluginReference[];
}

export interface DomainError {
  readonly kind: "domain";
  readonly code: "invalid_plugin_reference";
  readonly message: string;
}

export function parseReadablePluginReference(
  input: unknown,
): Result<PluginReference, DomainError> {
  if (typeof input !== "string" || !input.trim()) {
    return {
      ok: false,
      error: {
        kind: "domain",
        code: "invalid_plugin_reference",
        message: "Plugin entries must be non-empty strings.",
      },
    };
  }

  return { ok: true, value: input.trim() as PluginReference };
}

export function parseQualifiedPluginReference(
  input: unknown,
): Result<PluginReference, DomainError> {
  const readable = parseReadablePluginReference(input);
  if (!readable.ok) return readable;

  const reference = readable.value;
  const separator = reference.lastIndexOf("@");
  if (
    reference !== input ||
    /\s/.test(reference) ||
    separator <= 0 ||
    separator === reference.length - 1
  ) {
    return {
      ok: false,
      error: {
        kind: "domain",
        code: "invalid_plugin_reference",
        message: `Invalid qualified Plugin Reference: ${JSON.stringify(input)}.`,
      },
    };
  }

  return { ok: true, value: reference };
}

function uniqueInOrder(
  references: readonly PluginReference[],
): readonly PluginReference[] {
  return [...new Set(references)];
}

function sortedUnique(
  references: readonly PluginReference[],
): readonly PluginReference[] {
  return [...new Set(references)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

export function calculateDrift(
  manifest: ProjectManifest,
  installed: InstalledState,
): Drift {
  const declared = new Set(manifest.plugins);
  const observed = new Set(installed.plugins);

  return {
    missing: uniqueInOrder(
      manifest.plugins.filter((reference) => !observed.has(reference)),
    ),
    undeclared: sortedUnique(
      installed.plugins.filter((reference) => !declared.has(reference)),
    ),
  };
}
