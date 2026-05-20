#!/usr/bin/env node
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { execSync } from "node:child_process";
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

function readProfile(name: string) {
  const file = profilePath(name);
  if (!fs.existsSync(file)) {
    p.log.error(`Profile "${name}" not found.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function writeProfile(name: string, data: { name: string; plugins: string[] }) {
  ensureProfilesDir();
  fs.writeFileSync(profilePath(name), JSON.stringify(data, null, 2) + "\n");
}

function getProfileNames(): string[] {
  ensureProfilesDir();
  return fs
    .readdirSync(PROFILES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
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
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    for (const pl of data.plugins || []) {
      plugins.push({
        name: pl.name,
        description: pl.description || "",
        category: pl.category,
        marketplace: data.name,
      });
    }
  }
  return plugins;
}

// ── Commands ──────────────────────────────────────────────

async function addProfile(name?: string) {
  if (!name) {
    name = (await p.text({
      message: "Profile name:",
    })) as string;
    if (p.isCancel(name)) return;
  }
  const file = profilePath(name);
  if (fs.existsSync(file)) {
    p.log.error(`Profile "${name}" already exists.`);
    return;
  }
  writeProfile(name, { name, plugins: [] });
  p.log.success(`Created profile "${name}".`);
}

async function removeProfile(name?: string) {
  const names = getProfileNames();
  if (names.length === 0) {
    p.log.warn("No profiles found.");
    return;
  }
  if (!name) {
    name = (await p.select({
      message: "Select profile to remove:",
      options: names.map((n) => ({ value: n, label: n })),
    })) as string;
    if (p.isCancel(name)) return;
  }
  const file = profilePath(name);
  if (!fs.existsSync(file)) {
    p.log.error(`Profile "${name}" not found.`);
    return;
  }
  fs.unlinkSync(file);
  p.log.success(`Removed profile "${name}".`);
}

async function listProfiles() {
  ensureProfilesDir();
  const files = fs
    .readdirSync(PROFILES_DIR)
    .filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    p.log.warn("No profiles found.");
    return;
  }
  for (const f of files) {
    const data = JSON.parse(
      fs.readFileSync(path.join(PROFILES_DIR, f), "utf-8")
    );
    p.log.success(`${data.name}  (${data.plugins.length} plugins)`);
  }
}

async function addPlugin(profileName: string, plugin?: string) {
  const data = readProfile(profileName);
  if (!plugin) {
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
  if (data.plugins.includes(plugin)) {
    p.log.warn(`Plugin "${plugin}" already in profile.`);
    return;
  }
  data.plugins.push(plugin);
  writeProfile(profileName, data);
  p.log.success(`Added "${plugin}" to profile "${profileName}".`);
}

async function removePlugin(profileName: string, plugin?: string) {
  const data = readProfile(profileName);
  if (data.plugins.length === 0) {
    p.log.warn("No plugins in this profile.");
    return;
  }
  if (!plugin) {
    plugin = (await p.select({
      message: `Remove plugin from "${profileName}":`,
      options: data.plugins.map((pl: string) => ({
        value: pl,
        label: pl,
      })),
    })) as string;
    if (p.isCancel(plugin)) return;
  }
  const idx = data.plugins.indexOf(plugin);
  if (idx === -1) {
    p.log.error(`Plugin "${plugin}" not found.`);
    return;
  }
  data.plugins.splice(idx, 1);
  writeProfile(profileName, data);
  p.log.success(`Removed "${plugin}" from profile "${profileName}".`);
}

async function listPlugins(profileName: string) {
  const data = readProfile(profileName);
  if (data.plugins.length === 0) {
    p.log.warn(`No plugins in profile "${profileName}".`);
    return;
  }
  for (const pl of data.plugins) {
    p.log.success(pl);
  }
}

async function searchPlugins(keyword?: string) {
  if (!keyword) {
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
  const data = readProfile(profileName);
  if (data.plugins.length === 0) {
    p.log.warn(`No plugins to install in profile "${profileName}".`);
    return;
  }

  const s = p.spinner();
  s.start(`Installing ${data.plugins.length} plugin(s) from "${profileName}"...`);

  let installed = 0;
  let failed = 0;
  for (const plugin of data.plugins) {
    s.message(`Installing ${plugin}...`);
    try {
      execSync(`claude plugin install ${plugin} --scope project`, {
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
  ccx                           Interactive mode
  ccx <profile>                  Install all plugins from profile
  ccx add <name>                 Create a new profile
  ccx remove <name>              Remove a profile
  ccx list                       List all profiles
  ccx search <keyword>           Search plugins in marketplaces
  ccx <profile> add [plugin]     Add plugin to profile
  ccx <profile> remove [plugin]  Remove plugin from profile
  ccx <profile> list             List plugins in profile
  ccx -v, --version              Show version`);
}

// ── Main ──────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0) {
  interactiveMode();
  process.exit(0);
}

if (args[0] === "--help" || args[0] === "-h") {
  printHelp();
  process.exit(0);
}

if (args[0] === "--version" || args[0] === "-v" || args[0] === "-V") {
  const require = createRequire(import.meta.url);
  const pkg = require("../package.json");
  console.log(`ccx v${pkg.version}`);
  process.exit(0);
}

const cmd = args[0];

switch (cmd) {
  case "add":
    addProfile(args[1]);
    break;

  case "remove":
    removeProfile(args[1]);
    break;

  case "list":
    listProfiles();
    break;

  case "search":
    searchPlugins(args[1]);
    break;

  default: {
    const profileName = cmd;
    const sub = args[1];

    if (!sub) {
      executeProfile(profileName);
    } else if (sub === "add") {
      addPlugin(profileName, args[2]);
    } else if (sub === "remove") {
      removePlugin(profileName, args[2]);
    } else if (sub === "list") {
      listPlugins(profileName);
    } else {
      console.error(`Unknown command: ccx ${args.join(" ")}`);
      printHelp();
      process.exit(1);
    }
    break;
  }
}
