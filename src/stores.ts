import fs from "node:fs";
import path from "node:path";
import type {
  ManifestStore,
  ProfileStore,
  StoreError,
} from "./application.js";
import {
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
    read(name: string): Result<ProjectManifest, StoreError> {
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

      const file = path.join(profilesRoot, `${normalizedName}.json`);
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
  };
}
