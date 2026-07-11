import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type {
  ClaudeCliError,
  ClaudePluginClient,
} from "./application.js";
import {
  parseQualifiedPluginReference,
  type InstalledState,
  type Result,
} from "./domain.js";

function claudeError(
  code: ClaudeCliError["code"],
  message: string,
  details: Partial<Pick<ClaudeCliError, "status" | "stdout" | "stderr">> = {},
): Result<never, ClaudeCliError> {
  return {
    ok: false,
    error: {
      kind: "claude_cli",
      code,
      operation: "list",
      message,
      ...details,
    },
  };
}

function normalizeProjectPath(projectPath: string, projectRoot: string): string {
  const resolved = path.isAbsolute(projectPath)
    ? path.resolve(projectPath)
    : path.resolve(projectRoot, projectPath);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export function createClaudePluginClient(): ClaudePluginClient {
  return {
    listProject(projectRoot: string): Result<InstalledState, ClaudeCliError> {
      let child;
      try {
        child = spawnSync("claude", ["plugin", "list", "--json"], {
          cwd: projectRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        return claudeError(
          "spawn_failed",
          `Unable to run \`claude plugin list --json\`: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      const stdout = child.stdout || "";
      const stderr = child.stderr || "";

      if (child.error) {
        return claudeError(
          "spawn_failed",
          `Unable to run \`claude plugin list --json\`: ${child.error.message}`,
          { stdout, stderr },
        );
      }

      if (child.status !== 0) {
        return claudeError(
          "command_failed",
          child.status === null
            ? "`claude plugin list --json` terminated without an exit status."
            : `\`claude plugin list --json\` exited with status ${child.status}.`,
          {
            ...(child.status === null ? {} : { status: child.status }),
            stdout,
            stderr,
          },
        );
      }

      let data: unknown;
      try {
        data = JSON.parse(stdout);
      } catch {
        return claudeError(
          "invalid_json",
          "Claude returned invalid JSON from `claude plugin list --json`.",
          { stdout, stderr },
        );
      }

      if (!Array.isArray(data)) {
        return claudeError(
          "invalid_shape",
          "Claude returned an invalid plugin listing: expected a JSON array.",
          { stdout, stderr },
        );
      }

      const normalizedProjectRoot = normalizeProjectPath(projectRoot, projectRoot);
      const plugins = [];

      for (const [index, entry] of data.entries()) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return claudeError(
            "invalid_shape",
            `Claude returned an invalid plugin listing: entry ${index + 1} must be an object.`,
            { stdout, stderr },
          );
        }

        const scope = (entry as { scope?: unknown }).scope;
        if (typeof scope !== "string") {
          return claudeError(
            "invalid_shape",
            `Claude returned an invalid plugin listing: entry ${index + 1} has no valid scope.`,
            { stdout, stderr },
          );
        }
        if (scope !== "project") continue;

        const projectPath = (entry as { projectPath?: unknown }).projectPath;
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          return claudeError(
            "invalid_shape",
            `Claude returned an invalid plugin listing: project entry ${index + 1} has no valid projectPath.`,
            { stdout, stderr },
          );
        }
        if (
          normalizeProjectPath(projectPath, normalizedProjectRoot) !==
          normalizedProjectRoot
        ) {
          continue;
        }

        const reference = parseQualifiedPluginReference(
          (entry as { id?: unknown }).id,
        );
        if (!reference.ok) {
          return claudeError(
            "invalid_shape",
            `Claude returned an invalid plugin listing: project entry ${index + 1} has no valid qualified id.`,
            { stdout, stderr },
          );
        }
        plugins.push(reference.value);
      }

      return {
        ok: true,
        value: { projectRoot: normalizedProjectRoot, plugins },
      };
    },
  };
}
