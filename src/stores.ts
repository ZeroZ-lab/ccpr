import fs from "node:fs";
import path from "node:path";
import type { ManifestStore, StoreError } from "./application.js";
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

export function createManifestStore(): ManifestStore {
  return {
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
  };
}
