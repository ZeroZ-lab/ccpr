#!/usr/bin/env node
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as p from "@clack/prompts";

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
    const selected = await p.select({
      message: `Add plugin to "${profileName}":`,
      options: [
        ...available.map((pl) => ({
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

async function searchPlugins(keyword?: string) {
  if (!keyword) {
    if (!canPrompt()) {
      missingArg("Search keyword is required.", "ccx search <keyword>");
      return;
    }
    keyword = (await p.text({
      message: "Search plugins:",
    })) as string;
    if (p.isCancel(keyword)) return;
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
    return;
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

async function interactiveMode() {
  if (!canPrompt()) {
    printNonInteractiveHelp();
    process.exitCode = 1;
    return;
  }

  p.intro("ccx — Agent Profile Manager");

  const action = await p.select({
    message: "What do you want to do?",
    options: [
      { value: "install", label: "Install profile plugins", hint: "Run a profile to install its plugins" },
      { value: "plugin-add", label: "Add plugin to profile", hint: "Add a plugin to an existing profile" },
      { value: "plugin-remove", label: "Remove plugin from profile", hint: "Remove a plugin from a profile" },
      { value: "plugin-list", label: "List profile plugins", hint: "Show plugins in a profile" },
      { value: "add", label: "Create new profile", hint: "Create a new empty profile" },
      { value: "remove", label: "Delete profile", hint: "Remove a profile" },
      { value: "list", label: "List all profiles", hint: "Show all profiles" },
      { value: "search", label: "Search plugins", hint: "Search plugins in marketplaces" },
    ],
  });
  if (p.isCancel(action)) return;

  switch (action) {
    case "install": {
      const names = getProfileNames();
      if (names.length === 0) {
        p.log.warn("No profiles found.");
        return;
      }
      const name = await p.select({
        message: "Select profile to install:",
        options: names.map((n) => ({ value: n, label: n })),
      });
      if (p.isCancel(name)) return;
      await executeProfile(name as string);
      break;
    }
    case "plugin-add": {
      const names = getProfileNames();
      if (names.length === 0) {
        p.log.warn("No profiles found. Create one first.");
        return;
      }
      const name = await p.select({
        message: "Select profile:",
        options: names.map((n) => ({ value: n, label: n })),
      });
      if (p.isCancel(name)) return;
      await addPlugin(name as string);
      break;
    }
    case "plugin-remove": {
      const names = getProfileNames();
      if (names.length === 0) {
        p.log.warn("No profiles found.");
        return;
      }
      const name = await p.select({
        message: "Select profile:",
        options: names.map((n) => ({ value: n, label: n })),
      });
      if (p.isCancel(name)) return;
      await removePlugin(name as string);
      break;
    }
    case "plugin-list": {
      const names = getProfileNames();
      if (names.length === 0) {
        p.log.warn("No profiles found.");
        return;
      }
      const name = await p.select({
        message: "Select profile:",
        options: names.map((n) => ({ value: n, label: n })),
      });
      if (p.isCancel(name)) return;
      await listPlugins(name as string);
      break;
    }
    case "add":
      await addProfile();
      break;
    case "remove":
      await removeProfile();
      break;
    case "list":
      await listProfiles();
      break;
    case "search":
      await searchPlugins();
      break;
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
