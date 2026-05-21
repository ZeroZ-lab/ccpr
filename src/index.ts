#!/usr/bin/env node
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";

const PROFILES_DIR = path.join(process.env.HOME!, ".ccx", "profiles");
const MARKETPLACES_DIR = path.join(
  process.env.HOME!,
  ".claude",
  "plugins",
  "marketplaces"
);

function ensureProfilesDir() {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

function profilePath(name: string) {
  return path.join(PROFILES_DIR, `${name}.json`);
}

function isValidProfileName(name: string) {
  return /^[A-Za-z0-9._-]+$/.test(name) && name !== "." && name !== "..";
}

function normalizeProfileName(name?: string) {
  if (!name) return undefined;
  const normalized = name.trim();
  if (!isValidProfileName(normalized)) {
    console.error(
      "Invalid profile name. Use only letters, numbers, dots, underscores, and hyphens."
    );
    process.exitCode = 1;
    return undefined;
  }
  return normalized;
}

function normalizePluginName(plugin?: string) {
  if (!plugin) return undefined;
  const normalized = plugin.trim();
  if (!normalized) {
    console.error("Plugin name is required.");
    process.exitCode = 1;
    return undefined;
  }
  return normalized;
}

interface ProfileData {
  name: string;
  plugins: string[];
}

function readProfile(name: string): ProfileData {
  const normalized = normalizeProfileName(name);
  if (!normalized) process.exit(1);

  const file = profilePath(normalized);
  if (!fs.existsSync(file)) {
    p.log.error(`Profile "${normalized}" not found.`);
    process.exit(1);
  }

  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    p.log.error(`Invalid profile file "${normalized}". Expected valid JSON.`);
    process.exit(1);
  }

  if (
    !data ||
    typeof data !== "object" ||
    !Array.isArray((data as { plugins?: unknown }).plugins)
  ) {
    p.log.error(`Invalid profile file "${normalized}". Expected a plugins array.`);
    process.exit(1);
  }

  const plugins = (data as { plugins: unknown[] }).plugins.map((plugin) =>
    typeof plugin === "string" ? plugin.trim() : undefined
  );

  if (plugins.some((plugin) => !plugin)) {
    p.log.error(
      `Invalid profile file "${normalized}". Plugin entries must be non-empty strings.`
    );
    process.exit(1);
  }

  return {
    name: normalized,
    plugins: plugins as string[],
  };
}

function writeProfile(name: string, data: ProfileData) {
  const normalized = normalizeProfileName(name);
  if (!normalized) return;

  ensureProfilesDir();
  fs.writeFileSync(
    profilePath(normalized),
    JSON.stringify({ ...data, name: normalized }, null, 2) + "\n"
  );
}

function getProfileNames(): string[] {
  ensureProfilesDir();
  return fs
    .readdirSync(PROFILES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length));
}

interface PluginEntry {
  name: string;
  description: string;
  category?: string;
  marketplace: string;
}

function getAllPlugins(): PluginEntry[] {
  if (!fs.existsSync(MARKETPLACES_DIR)) return [];
  const plugins: PluginEntry[] = [];
  const dirs = fs.readdirSync(MARKETPLACES_DIR);
  for (const dir of dirs) {
    const file = path.join(
      MARKETPLACES_DIR,
      dir,
      ".claude-plugin",
      "marketplace.json"
    );
    if (!fs.existsSync(file)) continue;
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      p.log.warn(`Skipping invalid marketplace "${dir}".`);
      continue;
    }

    if (
      !data ||
      typeof data !== "object" ||
      !Array.isArray((data as { plugins?: unknown }).plugins)
    ) {
      p.log.warn(`Skipping invalid marketplace "${dir}".`);
      continue;
    }

    const marketplace =
      typeof (data as { name?: unknown }).name === "string"
        ? ((data as { name: string }).name || dir)
        : dir;

    for (const pl of (data as { plugins: unknown[] }).plugins) {
      if (!pl || typeof pl !== "object") continue;
      const name = (pl as { name?: unknown }).name;
      if (typeof name !== "string" || !name.trim()) continue;
      const description = (pl as { description?: unknown }).description;
      const category = (pl as { category?: unknown }).category;
      plugins.push({
        name: name.trim(),
        description: typeof description === "string" ? description : "",
        category: typeof category === "string" ? category : undefined,
        marketplace,
      });
    }
  }
  return plugins;
}

function canPrompt() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function printNonInteractiveHelp() {
  console.error("Interactive mode requires a TTY. Run `ccx --help` for command usage.");
  printHelp();
}

function missingArg(message: string, usage: string) {
  console.error(message);
  console.error(`Usage: ${usage}`);
  process.exitCode = 1;
}

async function selectProfileOrNew(): Promise<string | undefined> {
  const names = getProfileNames();
  if (names.length === 0) {
    const create = await p.confirm({
      message: "No profiles found. Create one?",
      initialValue: true,
    });
    if (p.isCancel(create) || !create) return undefined;
    await addProfile();
    return getProfileNames()[0];
  }

  const selected = await p.select({
    message: "Select profile:",
    options: [
      ...names.map((n) => ({ value: n, label: n })),
      { value: "__create__", label: "Create new profile...", hint: "Add a new profile" },
    ],
  });
  if (p.isCancel(selected)) return undefined;

  if (selected === "__create__") {
    await addProfile();
    const updated = getProfileNames();
    return updated[updated.length - 1];
  }

  return selected as string;
}

// ── Commands ──────────────────────────────────────────────

async function addProfile(name?: string) {
  if (!name) {
    if (!canPrompt()) {
      missingArg("Profile name is required.", "ccx create <name>");
      return;
    }
    name = (await p.text({
      message: "Profile name:",
    })) as string;
    if (p.isCancel(name)) return;
  }
  name = normalizeProfileName(name);
  if (!name) return;

  const file = profilePath(name);
  if (fs.existsSync(file)) {
    p.log.error(`Profile "${name}" already exists.`);
    return;
  }
  writeProfile(name, { name, plugins: [] });
  p.log.success(`Created profile "${name}".`);
}

async function removeProfile(name?: string) {
  if (!name && !canPrompt()) {
    missingArg("Profile name is required.", "ccx delete <name>");
    return;
  }

  const names = getProfileNames();
  if (names.length === 0) {
    p.log.warn("No profiles found.");
    return;
  }
  if (!name) {
    if (!canPrompt()) {
      missingArg("Profile name is required.", "ccx delete <name>");
      return;
    }
    name = (await p.select({
      message: "Select profile to remove:",
      options: names.map((n) => ({ value: n, label: n })),
    })) as string;
    if (p.isCancel(name)) return;
  }
  name = normalizeProfileName(name);
  if (!name) return;

  const file = profilePath(name);
  if (!fs.existsSync(file)) {
    p.log.error(`Profile "${name}" not found.`);
    return;
  }
  fs.unlinkSync(file);
  p.log.success(`Removed profile "${name}".`);
}

async function listProfiles() {
  const names = getProfileNames();
  if (names.length === 0) {
    p.log.warn("No profiles found.");
    return;
  }
  for (const name of names) {
    const data = readProfile(name);
    p.log.success(`${data.name}  (${data.plugins.length} plugins)`);
  }
}

async function addPlugin(profileName: string, plugin?: string) {
  const normalizedProfileName = normalizeProfileName(profileName);
  if (!normalizedProfileName) return;

  const data = readProfile(profileName);
  if (!plugin) {
    if (!canPrompt()) {
      missingArg("Plugin name is required.", "ccx add <profile> <plugin>");
      return;
    }
    const allPlugins = getAllPlugins();
    const available = allPlugins.filter(
      (pl) => !data.plugins.includes(pl.name)
    );
    if (available.length === 0) {
      p.log.warn("All available plugins already added.");
      return;
    }

    let filtered = available;
    if (available.length > 10) {
      const query = (await p.text({
        message: `Search plugins (leave empty to list all):`,
      })) as string;
      if (p.isCancel(query)) return;
      const q = query.trim().toLowerCase();
      if (q) {
        filtered = available.filter(
          (pl) =>
            pl.name.toLowerCase().includes(q) ||
            pl.description.toLowerCase().includes(q) ||
            (pl.category && pl.category.toLowerCase().includes(q)),
        );
        if (filtered.length === 0) {
          p.log.warn(`No plugins matching "${query.trim()}".`);
          return;
        }
      }
    }

    const selected = await p.select({
      message: `Add plugin to "${profileName}":`,
      options: [
        ...filtered.map((pl) => ({
          value: pl.name,
          label: pl.name,
          hint: pl.description.slice(0, 60),
        })),
        { value: "__url__", label: "Enter URL manually...", hint: "Input a GitHub URL or plugin name" },
      ],
    });
    if (p.isCancel(selected)) return;

    if (selected === "__url__") {
      plugin = (await p.text({
        message: "Plugin URL or name:",
      })) as string;
      if (p.isCancel(plugin)) return;
    } else {
      plugin = selected as string;
    }
  }
  plugin = normalizePluginName(plugin);
  if (!plugin) return;

  if (data.plugins.includes(plugin)) {
    p.log.warn(`Plugin "${plugin}" already in profile.`);
    return;
  }
  data.plugins.push(plugin);
  writeProfile(normalizedProfileName, data);
  p.log.success(`Added "${plugin}" to profile "${normalizedProfileName}".`);
}

async function removePlugin(profileName: string, plugin?: string) {
  const normalizedProfileName = normalizeProfileName(profileName);
  if (!normalizedProfileName) return;

  const data = readProfile(profileName);
  if (data.plugins.length === 0) {
    p.log.warn("No plugins in this profile.");
    return;
  }
  if (!plugin) {
    if (!canPrompt()) {
      missingArg("Plugin name is required.", "ccx remove <profile> <plugin>");
      return;
    }
    plugin = (await p.select({
      message: `Remove plugin from "${profileName}":`,
      options: data.plugins.map((pl: string) => ({
        value: pl,
        label: pl,
      })),
    })) as string;
    if (p.isCancel(plugin)) return;
  }
  plugin = normalizePluginName(plugin);
  if (!plugin) return;

  const idx = data.plugins.indexOf(plugin);
  if (idx === -1) {
    p.log.error(`Plugin "${plugin}" not found.`);
    return;
  }
  data.plugins.splice(idx, 1);
  writeProfile(normalizedProfileName, data);
  p.log.success(`Removed "${plugin}" from profile "${normalizedProfileName}".`);
}

async function listPlugins(profileName: string) {
  const normalizedProfileName = normalizeProfileName(profileName);
  if (!normalizedProfileName) return;

  const data = readProfile(normalizedProfileName);
  if (data.plugins.length === 0) {
    p.log.warn(`No plugins in profile "${normalizedProfileName}".`);
    return;
  }
  for (const pl of data.plugins) {
    p.log.success(pl);
  }
}

async function searchPlugins(keyword?: string, currentProfile?: string): Promise<string | undefined> {
  if (!keyword) {
    if (!canPrompt()) {
      missingArg("Search keyword is required.", "ccx search <keyword>");
      return undefined;
    }
    keyword = (await p.text({
      message: "Search plugins:",
    })) as string;
    if (p.isCancel(keyword)) return undefined;
  }
  const allPlugins = getAllPlugins();
  const lower = keyword.toLowerCase();
  const results = allPlugins.filter(
    (pl) =>
      pl.name.toLowerCase().includes(lower) ||
      pl.description.toLowerCase().includes(lower) ||
      (pl.category || "").toLowerCase().includes(lower)
  );
  if (results.length === 0) {
    p.log.warn(`No plugins matching "${keyword}".`);
    return undefined;
  }

  if (currentProfile) {
    const data = readProfile(currentProfile);
    const selected = await p.select({
      message: `Search results for "${keyword}":`,
      options: [
        ...results.map((pl) => ({
          value: pl.name,
          label: pl.name,
          hint: pl.description.slice(0, 60) + (data.plugins.includes(pl.name) ? " ✓" : ""),
        })),
        { value: "__back__", label: "Back", hint: "Return to menu" },
      ],
    });
    if (p.isCancel(selected) || selected === "__back__") return undefined;
    return selected as string;
  }

  const grouped = new Map<string, PluginEntry[]>();
  for (const pl of results) {
    const list = grouped.get(pl.marketplace) || [];
    list.push(pl);
    grouped.set(pl.marketplace, list);
  }

  console.log(`\n  Found ${results.length} plugin(s) for "${keyword}":\n`);
  for (const [marketplace, plugins] of grouped) {
    console.log(`  [${marketplace}]`);
    for (const pl of plugins) {
      const desc =
        pl.description.length > 70
          ? pl.description.slice(0, 67) + "..."
          : pl.description;
      console.log(`    ${pl.name.padEnd(24)} ${desc}`);
    }
    console.log();
  }
  return undefined;
}

async function executeProfile(profileName: string) {
  const normalizedProfileName = normalizeProfileName(profileName);
  if (!normalizedProfileName) return;

  const data = readProfile(normalizedProfileName);
  if (data.plugins.length === 0) {
    p.log.warn(`No plugins to install in profile "${normalizedProfileName}".`);
    return;
  }

  const s = p.spinner();
  s.start(`Installing ${data.plugins.length} plugin(s) from "${normalizedProfileName}"...`);

  let installed = 0;
  let failed = 0;
  for (const plugin of data.plugins) {
    s.message(`Installing ${plugin}...`);
    try {
      execFileSync("claude", ["plugin", "install", plugin, "--scope", "project"], {
        stdio: "pipe",
      });
      installed++;
    } catch {
      failed++;
      p.log.error(`Failed to install ${plugin}`);
    }
  }
  s.stop(`${installed} installed${failed > 0 ? `, ${failed} failed` : ""}`);
  p.log.success("Done.");
}

function printBanner() {
  const require = createRequire(import.meta.url);
  const pkg = require("../package.json");

  p.note(
    pc.bold("ccx") + pc.dim(" — Agent Profile Manager  ") + pc.gray(`v${pkg.version}`),
  );
}

async function interactiveMode() {
  if (!canPrompt()) {
    printNonInteractiveHelp();
    process.exitCode = 1;
    return;
  }

  printBanner();

  let currentProfile: string | undefined;

  // Profile selection loop
  while (true) {
    currentProfile = await selectProfileOrNew();
    if (!currentProfile) break;

    // Action loop — all operations on current profile
    let stayInProfile = true;
    while (stayInProfile && currentProfile) {
      const data = readProfile(currentProfile);
      const action = await p.select({
        message: pc.bold(pc.cyan(`[${currentProfile}]`)) + ` ${data.plugins.length} plugin(s)`,
        options: [
          { value: "install", label: "Install", hint: "Apply to current project" },
          { value: "add", label: "Add plugin", hint: "Search and add a plugin" },
          { value: "remove", label: "Remove plugin", hint: "Remove a plugin" },
          { value: "list", label: "List plugins", hint: "Show all plugins" },
          { value: "search", label: "Search marketplace", hint: "Find new plugins" },
          { value: "switch", label: "Switch profile", hint: "Choose a different profile" },
          { value: "delete", label: "Delete profile", hint: "Remove this profile" },
          { value: "exit", label: "Exit" },
        ],
      });
      if (p.isCancel(action) || action === "exit") {
        currentProfile = undefined;
        stayInProfile = false;
        break;
      }

      switch (action) {
        case "install":
          await executeProfile(currentProfile);
          break;
        case "add":
          await addPlugin(currentProfile);
          break;
        case "remove":
          await removePlugin(currentProfile);
          break;
        case "list":
          await listPlugins(currentProfile);
          break;
        case "search": {
          const found = await searchPlugins(undefined, currentProfile);
          if (found) {
            const d = readProfile(currentProfile);
            if (d.plugins.includes(found)) {
              p.log.warn(`"${found}" already in profile "${currentProfile}".`);
            } else {
              d.plugins.push(found);
              writeProfile(currentProfile, d);
              p.log.success(`Added "${found}" to profile "${currentProfile}".`);
            }
          }
          break;
        }
        case "switch":
          stayInProfile = false;
          break;
        case "delete":
          await removeProfile(currentProfile);
          currentProfile = undefined;
          stayInProfile = false;
          break;
      }
    }
  }

  p.outro("Done.");
}

function printHelp() {
  console.log(`ccx — Agent Profile Manager for Claude Code

Usage:
  ccx                            Interactive mode (TTY only)
  ccx ui                         Interactive mode (TTY only)
  ccx install <profile>          Install all plugins from profile
  ccx create <name>              Create a new profile
  ccx delete <name>              Remove a profile
  ccx profiles                   List all profiles
  ccx add <profile> <plugin>     Add plugin to profile
  ccx remove <profile> <plugin>  Remove plugin from profile
  ccx list <profile>             List plugins in profile
  ccx search <keyword>           Search plugins in marketplaces
  ccx <profile>                  Install all plugins from profile
  ccx <profile> add [plugin]     Add plugin to profile (legacy)
  ccx <profile> remove [plugin]  Remove plugin from profile (legacy)
  ccx <profile> list             List plugins in profile (legacy)
  ccx add <name>                 Create a new profile (legacy)
  ccx remove <name>              Remove a profile (legacy)
  ccx list                       List all profiles (legacy)
  ccx -v, --version              Show version`);
}

// ── Main ──────────────────────────────────────────────────

async function main(args: string[]) {
  if (args.length === 0) {
    await interactiveMode();
    return;
  }

  if (args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return;
  }

  if (args[0] === "--version" || args[0] === "-v" || args[0] === "-V") {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json");
    console.log(`ccx v${pkg.version}`);
    return;
  }

  const cmd = args[0];

  switch (cmd) {
    case "ui":
    case "tui":
    case "interactive":
      await interactiveMode();
      break;

    case "install":
      if (!args[1]) {
        missingArg("Profile name is required.", "ccx install <profile>");
        return;
      }
      await executeProfile(args[1]);
      break;

    case "create":
      await addProfile(args[1]);
      break;

    case "delete":
      await removeProfile(args[1]);
      break;

    case "profiles":
      await listProfiles();
      break;

    case "add":
      if (args[2]) {
        await addPlugin(args[1], args[2]);
      } else {
        await addProfile(args[1]);
      }
      break;

    case "remove":
      if (args[2]) {
        await removePlugin(args[1], args[2]);
      } else {
        await removeProfile(args[1]);
      }
      break;

    case "list":
      if (args[1]) {
        await listPlugins(args[1]);
      } else {
        await listProfiles();
      }
      break;

    case "search":
      await searchPlugins(args[1]);
      break;

    default: {
      const profileName = cmd;
      const sub = args[1];

      if (!sub) {
        await executeProfile(profileName);
      } else if (sub === "add") {
        await addPlugin(profileName, args[2]);
      } else if (sub === "remove") {
        await removePlugin(profileName, args[2]);
      } else if (sub === "list") {
        await listPlugins(profileName);
      } else {
        console.error(`Unknown command: ccx ${args.join(" ")}`);
        printHelp();
        process.exitCode = 1;
      }
      break;
    }
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
