#!/usr/bin/env node
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  applyProject,
  commitProjectImport,
  initializeEmptyProject,
  initializeProjectFromProfile,
  inspectProject,
  prepareProjectImport,
} from "./application.js";
import { createClaudePluginClient } from "./claude-cli.js";
import {
  routeProjectDiff,
  routeProjectInit,
  routeProjectImport,
  routeProjectUp,
} from "./presentation.js";
import { createManifestStore, createProfileStore } from "./stores.js";

const PROFILES_DIR = path.join(process.env.HOME!, ".ccx", "profiles");
const MARKETPLACES_DIR = path.join(
  process.env.HOME!,
  ".claude",
  "plugins",
  "marketplaces"
);
const PROJECT_CONFIG_FILE = ".ccx.json";
const LOGO_LINES = [
  "   ______ ______ __   __",
  "  / ____// ____/ \\ \\ / /",
  " | |    | |      \\ V /",
  " | |___ | |___   / . \\",
  "  \\____/ \\____/ /_/ \\_\\",
];

function renderLogo() {
  return LOGO_LINES.map((line, index) =>
    index < 2 ? pc.cyan(line) : pc.magenta(line),
  ).join("\n");
}

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

function readProjectConfig(): string[] {
  const file = path.join(process.cwd(), PROJECT_CONFIG_FILE);
  if (!fs.existsSync(file)) {
    p.log.error(`No ${PROJECT_CONFIG_FILE} found. Run \`ccx init\` to create one.`);
    process.exit(1);
  }

  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    p.log.error(`Invalid ${PROJECT_CONFIG_FILE}. Expected valid JSON.`);
    process.exit(1);
  }

  if (
    !data ||
    typeof data !== "object" ||
    !Array.isArray((data as { plugins?: unknown }).plugins)
  ) {
    p.log.error(`Invalid ${PROJECT_CONFIG_FILE}. Expected a plugins array.`);
    process.exit(1);
  }

  const plugins = (data as { plugins: unknown[] }).plugins.map((plugin) =>
    typeof plugin === "string" ? plugin.trim() : undefined
  );

  if (plugins.some((plugin) => !plugin)) {
    p.log.error(`Invalid ${PROJECT_CONFIG_FILE}. Plugin entries must be non-empty strings.`);
    process.exit(1);
  }

  return plugins as string[];
}

function writeProjectConfig(plugins: string[]) {
  fs.writeFileSync(
    path.join(process.cwd(), PROJECT_CONFIG_FILE),
    JSON.stringify({ plugins }, null, 2) + "\n"
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

    const selected = await p.multiselect({
      message: `Select plugins to add to "${profileName}":`,
      options: [
        ...filtered.map((pl) => ({
          value: pl.name,
          label: pl.name,
          hint: pl.description.slice(0, 50),
        })),
      ],
      required: false,
    });
    if (p.isCancel(selected)) return;

    for (const name of selected as string[]) {
      data.plugins.push(name);
    }
    writeProfile(normalizedProfileName, data);
    if ((selected as string[]).length > 0) {
      p.log.success(`Added ${(selected as string[]).length} plugin(s) to profile "${normalizedProfileName}".`);
    }
    return;
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

async function browsePlugins(currentProfile?: string): Promise<string[]> {
  const allPlugins = getAllPlugins();
  if (allPlugins.length === 0) {
    p.log.warn("No plugins available in marketplaces.");
    return [];
  }

  let plugins = allPlugins;

  if (allPlugins.length > 15) {
    const query = (await p.text({
      message: "Search plugins (leave empty to list all):",
    })) as string;
    if (p.isCancel(query)) return [];

    const q = query.trim().toLowerCase();
    if (q) {
      plugins = allPlugins.filter(
        (pl) =>
          pl.name.toLowerCase().includes(q) ||
          pl.description.toLowerCase().includes(q) ||
          (pl.category || "").toLowerCase().includes(q),
      );
      if (plugins.length === 0) {
        p.log.warn(`No plugins matching "${query.trim()}".`);
        return [];
      }
    }
  }

  if (currentProfile) {
    const data = readProfile(currentProfile);
    const selected = await p.multiselect({
      message: "Select plugins to add:",
      options: plugins.map((pl) => ({
        value: pl.name,
        label: pl.name,
        hint: pl.description.slice(0, 50) + (data.plugins.includes(pl.name) ? " (installed)" : ""),
      })),
      required: false,
    });
    if (p.isCancel(selected)) return [];
    return (selected as string[]).filter((name) => !data.plugins.includes(name));
  }

  const grouped = new Map<string, PluginEntry[]>();
  for (const pl of plugins) {
    const list = grouped.get(pl.marketplace) || [];
    list.push(pl);
    grouped.set(pl.marketplace, list);
  }

  console.log(`\n  ${plugins.length} plugin(s) available:\n`);
  for (const [marketplace, mPlugins] of grouped) {
    console.log(`  [${marketplace}]`);
    for (const pl of mPlugins) {
      const desc =
        pl.description.length > 70
          ? pl.description.slice(0, 67) + "..."
          : pl.description;
      console.log(`    ${pl.name.padEnd(24)} ${desc}`);
    }
    console.log();
  }
  return [];
}

async function installPlugins(plugins: string[], label: string) {
  const s = p.spinner();
  s.start(`Installing ${plugins.length} plugin(s) from "${label}"...`);

  let installed = 0;
  let failed = 0;
  for (const plugin of plugins) {
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

async function executeProfile(profileName: string) {
  const normalizedProfileName = normalizeProfileName(profileName);
  if (!normalizedProfileName) return;

  const data = readProfile(normalizedProfileName);
  if (data.plugins.length === 0) {
    p.log.warn(`No plugins to install in profile "${normalizedProfileName}".`);
    return;
  }

  await installPlugins(data.plugins, normalizedProfileName);
}

async function executeProjectConfig() {
  const file = path.join(process.cwd(), PROJECT_CONFIG_FILE);
  if (!fs.existsSync(file)) {
    p.log.error(`No ${PROJECT_CONFIG_FILE} found. Run \`ccx init\` to create one.`);
    process.exitCode = 1;
    return;
  }

  const plugins = readProjectConfig();
  if (plugins.length === 0) {
    p.log.warn(`No plugins in ${PROJECT_CONFIG_FILE}.`);
    return;
  }

  await installPlugins(plugins, PROJECT_CONFIG_FILE);
}

async function initProjectConfig() {
  if (!canPrompt()) {
    console.error("ccx init requires a TTY.");
    process.exitCode = 1;
    return;
  }

  const file = path.join(process.cwd(), PROJECT_CONFIG_FILE);
  if (fs.existsSync(file)) {
    const overwrite = await p.confirm({
      message: `${PROJECT_CONFIG_FILE} already exists. Overwrite?`,
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) return;
  }

  const allPlugins = getAllPlugins();
  let selected: string[];

  if (allPlugins.length === 0) {
    const input = (await p.text({
      message: "No marketplace plugins found. Enter plugin names (comma-separated):",
      placeholder: "plugin-a, plugin-b",
    })) as string;
    if (p.isCancel(input)) return;
    selected = input.split(",").map((s: string) => s.trim()).filter(Boolean);
  } else {
    let filtered = allPlugins;
    if (allPlugins.length > 10) {
      const query = (await p.text({
        message: "Search plugins (leave empty to list all):",
      })) as string;
      if (p.isCancel(query)) return;
      const q = query.trim().toLowerCase();
      if (q) {
        filtered = allPlugins.filter(
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

    const picked = await p.multiselect({
      message: "Select plugins for this project:",
      options: filtered.map((pl) => ({
        value: pl.name,
        label: pl.name,
        hint: pl.description.slice(0, 50),
      })),
      required: false,
    });
    if (p.isCancel(picked)) return;
    selected = picked as string[];
  }

  writeProjectConfig(selected);
  p.log.success(`Created ${PROJECT_CONFIG_FILE} with ${selected.length} plugin(s).`);
}

function syncProjectConfig() {
  const pluginsDir = path.join(process.cwd(), ".claude", "plugins");
  if (!fs.existsSync(pluginsDir)) {
    p.log.warn("No project plugins found (.claude/plugins/).");
    return;
  }

  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  const plugins = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !name.startsWith("."))
    .sort();

  if (plugins.length === 0) {
    p.log.warn("No project plugins found (.claude/plugins/).");
    return;
  }

  writeProjectConfig(plugins);
  p.log.success(`Synced ${plugins.length} plugin(s) to ${PROJECT_CONFIG_FILE}.`);
}

async function saveToProfile(name?: string) {
  const plugins = readProjectConfig();

  if (!name) {
    if (!canPrompt()) {
      missingArg("Profile name is required.", "ccx save <name>");
      return;
    }
    name = (await p.text({
      message: "Save as profile:",
    })) as string;
    if (p.isCancel(name)) return;
  }
  name = normalizeProfileName(name);
  if (!name) return;

  const file = profilePath(name);
  if (fs.existsSync(file)) {
    const overwrite = await p.confirm({
      message: `Profile "${name}" already exists. Overwrite?`,
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) return;
  }

  writeProfile(name, { name, plugins });
  p.log.success(`Saved ${plugins.length} plugin(s) to profile "${name}".`);
}

function printBanner() {
  const require = createRequire(import.meta.url);
  const pkg = require("../package.json");

  console.log(`${renderLogo()}\n`);
  p.note(
    pc.bold("ccx") + pc.dim(" - Agent Profile Manager  ") + pc.gray(`v${pkg.version}`),
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
      const pluginList = data.plugins.length > 0
        ? data.plugins.map((pl) => `  ${pc.dim("•")} ${pl}`).join("\n")
        : pc.dim("  (empty)");
      p.note(`${pc.bold(pc.cyan(currentProfile))}\n${pluginList}`);
      const action = await p.select({
        message: "Choose action:",
        options: [
          { value: "install", label: "Install", hint: "Install all plugins from profile" },
          { value: "add", label: "Add plugin", hint: "Add a plugin to profile" },
          { value: "remove", label: "Remove plugin", hint: "Remove a plugin from profile" },
          { value: "list", label: "List plugins", hint: "List plugins in current profile" },
          { value: "search", label: "Search marketplace", hint: "Search plugins in marketplaces" },
          { value: "init", label: "Init project", hint: "Create .ccx.json for this project" },
          { value: "sync", label: "Sync project", hint: "Sync .claude/plugins/ to .ccx.json" },
          { value: "save", label: "Save as profile", hint: "Save .ccx.json plugins to a profile" },
          { value: "switch", label: "Switch profile", hint: "Choose a different profile" },
          { value: "delete", label: "Delete profile", hint: "Delete this profile" },
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
          const found = await browsePlugins(currentProfile);
          if (found.length > 0) {
            const d = readProfile(currentProfile);
            d.plugins.push(...found);
            writeProfile(currentProfile, d);
            p.log.success(`Added ${found.length} plugin(s) to profile "${currentProfile}".`);
          }
          break;
        }
        case "init":
          await initProjectConfig();
          break;
        case "sync":
          syncProjectConfig();
          break;
        case "save":
          await saveToProfile();
          break;
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
  const require = createRequire(import.meta.url);
  const pkg = require("../package.json");

  console.log(`${renderLogo()}
${pc.bold("ccx")} ${pc.dim("- Agent Profile Manager for Claude Code")}  ${pc.gray(`v${pkg.version}`)}

${pc.bold("Usage:")}
  ${pc.cyan("ccx")}                            Interactive mode (TTY)
  ${pc.cyan("ccx ui")}                         Interactive mode (TTY)

${pc.bold("Project:")}
  ${pc.cyan("ccx init")}                       Create .ccx.json for current project
  ${pc.cyan("ccx sync")}                       Sync installed plugins to .ccx.json
  ${pc.cyan("ccx install")}                    Install plugins from .ccx.json
  ${pc.cyan("ccx save")} ${pc.dim("[name]")}                Save .ccx.json as a reusable profile

${pc.bold("Profiles:")}
  ${pc.cyan("ccx create")} ${pc.dim("<name>")}              Create a new profile
  ${pc.cyan("ccx delete")} ${pc.dim("<name>")}              Delete a profile
  ${pc.cyan("ccx profiles")}                   List all profiles

${pc.bold("Plugins:")}
  ${pc.cyan("ccx install")} ${pc.dim("<profile>")}          Install all plugins from a profile
  ${pc.cyan("ccx add")} ${pc.dim("<profile> <plugin>")}     Add a plugin to a profile
  ${pc.cyan("ccx remove")} ${pc.dim("<profile> <plugin>")}  Remove a plugin from a profile
  ${pc.cyan("ccx list")} ${pc.dim("<profile>")}             List plugins in a profile
  ${pc.cyan("ccx search")} ${pc.dim("<keyword>")}           Search plugins in marketplaces

${pc.bold("Options:")}
  ${pc.cyan("ccx -v, --version")}              Show version

${pc.dim("Legacy:")}
  ${pc.dim("ccx <profile>")}                  ${pc.dim("Same as ccx install <profile>")}
  ${pc.dim("ccx <profile> add [plugin]")}     ${pc.dim("Same as ccx add <profile> <plugin>")}
  ${pc.dim("ccx <profile> remove [plugin]")}  ${pc.dim("Same as ccx remove <profile> <plugin>")}
  ${pc.dim("ccx <profile> list")}             ${pc.dim("Same as ccx list <profile>")}
  ${pc.dim("ccx add <name>")}                 ${pc.dim("Same as ccx create <name>")}
  ${pc.dim("ccx remove <name>")}              ${pc.dim("Same as ccx delete <name>")}
  ${pc.dim("ccx list")}                       ${pc.dim("Same as ccx profiles")}`);
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

  const projectInitStatus = routeProjectInit(args, {
    initializeEmpty: (force) =>
      initializeEmptyProject(process.cwd(), createManifestStore(), force),
    initializeFromProfile: (profileName, force) =>
      initializeProjectFromProfile(
        process.cwd(),
        profileName,
        {
          manifestStore: createManifestStore(),
          profileStore: createProfileStore(process.env.HOME!),
        },
        force,
      ),
    writeStdout: (output) => process.stdout.write(output),
    writeStderr: (output) => process.stderr.write(output),
  });
  if (projectInitStatus !== undefined) {
    process.exitCode = projectInitStatus;
    return;
  }

  const projectImportStatus = routeProjectImport(args, {
    projectRoot: process.cwd(),
    prepare: (projectRoot) =>
      prepareProjectImport(projectRoot, {
        manifestStore: createManifestStore(),
        claudePluginClient: createClaudePluginClient(),
      }),
    commit: (projectRoot, preview) =>
      commitProjectImport(projectRoot, preview, createManifestStore()),
    isInteractive: canPrompt(),
    writeStdout: (output) => process.stdout.write(output),
    writeStderr: (output) => process.stderr.write(output),
  });
  if (projectImportStatus !== undefined) {
    process.exitCode = projectImportStatus;
    return;
  }

  const projectDiffStatus = routeProjectDiff(args, {
    projectRoot: process.cwd(),
    inspect: (projectRoot) =>
      inspectProject(projectRoot, {
        manifestStore: createManifestStore(),
        claudePluginClient: createClaudePluginClient(),
      }),
    writeStdout: (output) => process.stdout.write(output),
    writeStderr: (output) => process.stderr.write(output),
  });
  if (projectDiffStatus !== undefined) {
    process.exitCode = projectDiffStatus;
    return;
  }

  const projectUpStatus = routeProjectUp(args, {
    projectRoot: process.cwd(),
    apply: (projectRoot) =>
      applyProject(projectRoot, {
        manifestStore: createManifestStore(),
        claudePluginClient: createClaudePluginClient(),
      }),
    writeStdout: (output) => process.stdout.write(output),
    writeStderr: (output) => process.stderr.write(output),
  });
  if (projectUpStatus !== undefined) {
    process.exitCode = projectUpStatus;
    return;
  }

  const cmd = args[0];

  switch (cmd) {
    case "init":
      await initProjectConfig();
      break;

    case "sync":
      syncProjectConfig();
      break;

    case "save":
      await saveToProfile(args[1]);
      break;

    case "ui":
    case "tui":
    case "interactive":
      await interactiveMode();
      break;

    case "install":
      if (!args[1]) {
        await executeProjectConfig();
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
      await browsePlugins();
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
