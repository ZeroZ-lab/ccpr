import fs from "node:fs";
import path from "node:path";
import type {
  CatalogPlugin,
  ManifestStore,
  MarketplaceCatalogStore,
  ProfileStore,
  StoreError,
} from "./application.js";
import {
  parseQualifiedPluginReference,
  parseReadablePluginReference,
  type ProjectManifest,
  type Result,
} from "./domain.js";

const PROJECT_MANIFEST = ".ccx.json";

function storeError(
  code: StoreError["code"],
  manifestPath: string,
  message: string,
): Result<never, StoreError> {
  return {
    ok: false,
    error: {
      kind: "store",
      code,
      subject: "manifest",
      path: manifestPath,
      message,
    },
  };
}

function profileStoreError(
  code: StoreError["code"],
  profilePath: string,
  message: string,
): Result<never, StoreError> {
  return {
    ok: false,
    error: {
      kind: "store",
      code,
      subject: "profile",
      path: profilePath,
      message,
    },
  };
}

function catalogStoreError(
  catalogPath: string,
  message: string,
): Result<never, StoreError> {
  return {
    ok: false,
    error: {
      kind: "store",
      code: "read_failed",
      subject: "catalog",
      path: catalogPath,
      message,
    },
  };
}

function resolveProfileFile(
  profilesRoot: string,
  name: string,
): Result<{ readonly name: string; readonly file: string }, StoreError> {
  const normalizedName = name.trim();
  if (
    !/^[A-Za-z0-9._-]+$/.test(normalizedName) ||
    normalizedName === "." ||
    normalizedName === ".."
  ) {
    return profileStoreError(
      "invalid_data",
      profilesRoot,
      "Invalid profile name. Use only letters, numbers, dots, underscores, and hyphens.",
    );
  }
  return {
    ok: true,
    value: {
      name: normalizedName,
      file: path.join(profilesRoot, `${normalizedName}.json`),
    },
  };
}

export function createManifestStore(): ManifestStore {
  return {
    exists(projectRoot: string): Result<boolean, StoreError> {
      const manifestPath = path.join(projectRoot, PROJECT_MANIFEST);
      try {
        fs.statSync(manifestPath);
        return { ok: true, value: true };
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return { ok: true, value: false };
        }
        return storeError(
          "read_failed",
          manifestPath,
          `Unable to inspect ${manifestPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },

    read(projectRoot: string): Result<ProjectManifest, StoreError> {
      const manifestPath = path.join(projectRoot, PROJECT_MANIFEST);
      let contents: string;

      try {
        contents = fs.readFileSync(manifestPath, "utf8");
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return storeError(
            "not_found",
            manifestPath,
            `No ${PROJECT_MANIFEST} found in ${projectRoot}. Run \`ccx init\` to create one.`,
          );
        }

        return storeError(
          "read_failed",
          manifestPath,
          `Unable to read ${manifestPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      let data: unknown;
      try {
        data = JSON.parse(contents);
      } catch {
        return storeError(
          "invalid_json",
          manifestPath,
          `Invalid ${PROJECT_MANIFEST} at ${manifestPath}: expected valid JSON.`,
        );
      }

      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        !Array.isArray((data as { plugins?: unknown }).plugins)
      ) {
        return storeError(
          "invalid_data",
          manifestPath,
          `Invalid ${PROJECT_MANIFEST} at ${manifestPath}: expected a plugins array.`,
        );
      }

      const plugins = [];
      for (const entry of (data as { plugins: unknown[] }).plugins) {
        const reference = parseReadablePluginReference(entry);
        if (!reference.ok) {
          return storeError(
            "invalid_data",
            manifestPath,
            `Invalid ${PROJECT_MANIFEST} at ${manifestPath}: plugin entries must be non-empty strings.`,
          );
        }
        plugins.push(reference.value);
      }

      return { ok: true, value: { plugins } };
    },

    write(
      projectRoot: string,
      manifest: ProjectManifest,
    ): Result<void, StoreError> {
      const manifestPath = path.join(projectRoot, PROJECT_MANIFEST);
      try {
        fs.writeFileSync(
          manifestPath,
          `${JSON.stringify({ plugins: manifest.plugins }, null, 2)}\n`,
        );
      } catch (error) {
        return storeError(
          "write_failed",
          manifestPath,
          `Unable to write ${manifestPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      return { ok: true, value: undefined };
    },
  };
}

export function createProfileStore(homeRoot: string): ProfileStore {
  const profilesRoot = path.join(homeRoot, ".ccx", "profiles");

  return {
    exists(name: string): Result<boolean, StoreError> {
      const resolved = resolveProfileFile(profilesRoot, name);
      if (!resolved.ok) return resolved;
      try {
        fs.statSync(resolved.value.file);
        return { ok: true, value: true };
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return { ok: true, value: false };
        }
        return profileStoreError(
          "read_failed",
          resolved.value.file,
          `Unable to inspect ${resolved.value.file}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },

    list(): Result<readonly string[], StoreError> {
      try {
        const names = fs
          .readdirSync(profilesRoot, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map((entry) => entry.name.slice(0, -".json".length))
          .sort();
        return { ok: true, value: names };
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return { ok: true, value: [] };
        }
        return profileStoreError(
          "read_failed",
          profilesRoot,
          `Unable to list ${profilesRoot}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },

    read(name: string): Result<ProjectManifest, StoreError> {
      const resolved = resolveProfileFile(profilesRoot, name);
      if (!resolved.ok) return resolved;
      const { file, name: normalizedName } = resolved.value;
      let contents: string;
      try {
        contents = fs.readFileSync(file, "utf8");
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return profileStoreError(
            "not_found",
            file,
            `Profile ${JSON.stringify(normalizedName)} not found.`,
          );
        }
        return profileStoreError(
          "read_failed",
          file,
          `Unable to read ${file}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      let data: unknown;
      try {
        data = JSON.parse(contents);
      } catch {
        return profileStoreError(
          "invalid_json",
          file,
          `Invalid profile ${JSON.stringify(normalizedName)}: expected valid JSON.`,
        );
      }

      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        !Array.isArray((data as { plugins?: unknown }).plugins)
      ) {
        return profileStoreError(
          "invalid_data",
          file,
          `Invalid profile ${JSON.stringify(normalizedName)}: expected a plugins array.`,
        );
      }

      const plugins = [];
      for (const entry of (data as { plugins: unknown[] }).plugins) {
        const reference = parseReadablePluginReference(entry);
        if (!reference.ok) {
          return profileStoreError(
            "invalid_data",
            file,
            `Invalid profile ${JSON.stringify(normalizedName)}: plugin entries must be non-empty strings.`,
          );
        }
        plugins.push(reference.value);
      }

      return { ok: true, value: { plugins } };
    },

    write(
      name: string,
      manifest: ProjectManifest,
    ): Result<void, StoreError> {
      const resolved = resolveProfileFile(profilesRoot, name);
      if (!resolved.ok) return resolved;
      try {
        fs.mkdirSync(profilesRoot, { recursive: true });
        fs.writeFileSync(
          resolved.value.file,
          `${JSON.stringify({
            name: resolved.value.name,
            plugins: manifest.plugins,
          }, null, 2)}\n`,
        );
        return { ok: true, value: undefined };
      } catch (error) {
        return profileStoreError(
          "write_failed",
          resolved.value.file,
          `Unable to write ${resolved.value.file}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },

    remove(name: string): Result<void, StoreError> {
      const resolved = resolveProfileFile(profilesRoot, name);
      if (!resolved.ok) return resolved;
      try {
        fs.unlinkSync(resolved.value.file);
        return { ok: true, value: undefined };
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return profileStoreError(
            "not_found",
            resolved.value.file,
            `Profile ${JSON.stringify(resolved.value.name)} not found.`,
          );
        }
        return profileStoreError(
          "write_failed",
          resolved.value.file,
          `Unable to remove ${resolved.value.file}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  };
}

export function createMarketplaceCatalogStore(
  homeRoot: string,
): MarketplaceCatalogStore {
  const marketplacesRoot = path.join(
    homeRoot,
    ".claude",
    "plugins",
    "marketplaces",
  );

  return {
    list(): Result<readonly CatalogPlugin[], StoreError> {
      let directories: fs.Dirent[];
      try {
        directories = fs.readdirSync(marketplacesRoot, { withFileTypes: true });
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return { ok: true, value: [] };
        }
        return catalogStoreError(
          marketplacesRoot,
          `Unable to list ${marketplacesRoot}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      const plugins: CatalogPlugin[] = [];
      for (const directory of directories.filter((entry) => entry.isDirectory())) {
        const catalogPath = path.join(
          marketplacesRoot,
          directory.name,
          ".claude-plugin",
          "marketplace.json",
        );
        if (!fs.existsSync(catalogPath)) continue;

        let data: unknown;
        try {
          data = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
        } catch {
          continue;
        }
        if (
          !data ||
          typeof data !== "object" ||
          Array.isArray(data) ||
          !Array.isArray((data as { plugins?: unknown }).plugins)
        ) {
          continue;
        }

        const declaredMarketplace = (data as { name?: unknown }).name;
        const marketplace = typeof declaredMarketplace === "string" &&
            declaredMarketplace.trim()
          ? declaredMarketplace.trim()
          : directory.name;

        for (const entry of (data as { plugins: unknown[] }).plugins) {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            continue;
          }
          const name = (entry as { name?: unknown }).name;
          if (typeof name !== "string" || !name.trim()) continue;
          const reference = parseQualifiedPluginReference(
            `${name.trim()}@${marketplace}`,
          );
          if (!reference.ok) continue;
          const description = (entry as { description?: unknown }).description;
          const category = (entry as { category?: unknown }).category;
          plugins.push({
            reference: reference.value,
            description: typeof description === "string" ? description : "",
            ...(typeof category === "string" && category
              ? { category }
              : {}),
            marketplace,
          });
        }
      }

      const unique = new Map<string, CatalogPlugin>();
      for (const plugin of plugins) {
        if (!unique.has(plugin.reference)) unique.set(plugin.reference, plugin);
      }
      return {
        ok: true,
        value: [...unique.values()].sort((left, right) =>
          left.reference.localeCompare(right.reference)
        ),
      };
    },
  };
}
