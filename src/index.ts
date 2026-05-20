#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import pc from "picocolors";
import ora from "ora";
import { select, input } from "@inquirer/prompts";

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
    console.error(pc.red(`Profile "${name}" not found.`));
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
    for (const p of data.plugins || []) {
      plugins.push({
        name: p.name,
        description: p.description || "",
        category: p.category,
        marketplace: data.name,
      });
    }
  }
  return plugins;
}

// ── Commands ──────────────────────────────────────────────

async function addProfile(name?: string) {
  if (!name) {
    name = await input({ message: "Profile name:" });
  }
  const file = profilePath(name);
  if (fs.existsSync(file)) {
    console.error(pc.red(`Profile "${name}" already exists.`));
    process.exit(1);
  }
  writeProfile(name, { name, plugins: [] });
  console.log(pc.green(`Created profile "${name}".`));
}

async function removeProfile(name?: string) {
  const names = getProfileNames();
  if (names.length === 0) {
    console.log(pc.yellow("No profiles found."));
    return;
  }
  if (!name) {
    name = (await select({
      message: "Select profile to remove:",
      choices: names.map((n) => ({ name: n, value: n })),
    })) as string;
  }
  const file = profilePath(name);
  if (!fs.existsSync(file)) {
    console.error(pc.red(`Profile "${name}" not found.`));
    process.exit(1);
  }
  fs.unlinkSync(file);
  console.log(pc.green(`Removed profile "${name}".`));
}

async function listProfiles() {
  ensureProfilesDir();
  const files = fs
    .readdirSync(PROFILES_DIR)
    .filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log(pc.yellow("No profiles found."));
    return;
  }
  console.log(pc.bold("Profiles:"));
  for (const f of files) {
    const data = JSON.parse(
      fs.readFileSync(path.join(PROFILES_DIR, f), "utf-8")
    );
    console.log(
      `  ${pc.cyan(data.name)}  ${pc.dim(`(${data.plugins.length} plugins)`)}`
    );
  }
}

async function addPlugin(profileName: string, plugin?: string) {
  const data = readProfile(profileName);
  if (!plugin) {
    const allPlugins = getAllPlugins();
    const available = allPlugins.filter(
      (p) => !data.plugins.includes(p.name)
    );
    if (available.length === 0) {
      console.log(pc.yellow("All available plugins already added."));
      return;
    }
    const choices = [
      ...available.map((p) => ({
        name: `${pc.cyan(p.name)}  ${pc.dim(p.description.slice(0, 60))}  ${pc.dim(`[${p.marketplace}]`)}`,
        value: p.name,
        description: p.description,
      })),
      { name: pc.yellow("Enter URL manually..."), value: "__url__" },
    ];
    const selected = (await select({
      message: `Add plugin to "${profileName}":`,
      choices,
    })) as string;
    if (selected === "__url__") {
      plugin = await input({ message: "Plugin URL or name:" });
    } else {
      plugin = selected;
    }
  }
  if (data.plugins.includes(plugin)) {
    console.error(pc.yellow(`Plugin "${plugin}" already in profile.`));
    return;
  }
  data.plugins.push(plugin);
  writeProfile(profileName, data);
  console.log(pc.green(`Added "${plugin}" to profile "${profileName}".`));
}

async function removePlugin(profileName: string, plugin?: string) {
  const data = readProfile(profileName);
  if (data.plugins.length === 0) {
    console.log(pc.yellow("No plugins in this profile."));
    return;
  }
  if (!plugin) {
    plugin = (await select({
      message: `Remove plugin from "${profileName}":`,
      choices: data.plugins.map((p: string) => ({ name: p, value: p })),
    })) as string;
  }
  const idx = data.plugins.indexOf(plugin);
  if (idx === -1) {
    console.error(pc.red(`Plugin "${plugin}" not found.`));
    process.exit(1);
  }
  data.plugins.splice(idx, 1);
  writeProfile(profileName, data);
  console.log(pc.green(`Removed "${plugin}" from profile "${profileName}".`));
}

async function listPlugins(profileName: string) {
  const data = readProfile(profileName);
  if (data.plugins.length === 0) {
    console.log(pc.yellow(`No plugins in profile "${profileName}".`));
    return;
  }
  console.log(pc.bold(`Plugins in "${profileName}":`));
  for (const p of data.plugins) {
    console.log(`  ${pc.cyan(p)}`);
  }
}

async function searchPlugins(keyword?: string) {
  if (!keyword) {
    keyword = await input({ message: "Search plugins:" });
  }
  const allPlugins = getAllPlugins();
  const lower = keyword.toLowerCase();
  const results = allPlugins.filter(
    (p) =>
      p.name.toLowerCase().includes(lower) ||
      p.description.toLowerCase().includes(lower) ||
      (p.category || "").toLowerCase().includes(lower)
  );
  if (results.length === 0) {
    console.log(pc.yellow(`No plugins matching "${keyword}".`));
    return;
  }
  console.log(
    pc.bold(`Found ${results.length} plugin(s) for "${keyword}":\n`)
  );
  // Group by marketplace
  const grouped = new Map<string, PluginEntry[]>();
  for (const p of results) {
    const list = grouped.get(p.marketplace) || [];
    list.push(p);
    grouped.set(p.marketplace, list);
  }
  for (const [marketplace, plugins] of grouped) {
    console.log(pc.bold(pc.dim(`  [${marketplace}]`)));
    for (const p of plugins) {
      const desc =
        p.description.length > 70
          ? p.description.slice(0, 67) + "..."
          : p.description;
      console.log(`    ${pc.cyan(p.name.padEnd(24))} ${pc.dim(desc)}`);
    }
    console.log();
  }
}

async function executeProfile(profileName: string) {
  const data = readProfile(profileName);
  if (data.plugins.length === 0) {
    console.log(pc.yellow(`No plugins to install in profile "${profileName}".`));
    return;
  }
  console.log(
    pc.bold(
      `Installing ${data.plugins.length} plugin(s) from profile "${profileName}"...\n`
    )
  );
  for (const plugin of data.plugins) {
    const spinner = ora(`Installing ${pc.cyan(plugin)}...`).start();
    try {
      execSync(`claude plugin install ${plugin} --scope project`, {
        stdio: "pipe",
      });
      spinner.succeed(`Installed ${pc.cyan(plugin)}`);
    } catch {
      spinner.fail(`Failed to install ${pc.red(plugin)}`);
    }
  }
  console.log(pc.green("\nDone."));
}

async function interactiveMode() {
  const action = (await select({
    message: "What do you want to do?",
    choices: [
      { name: "Install profile plugins", value: "install", description: "Run a profile to install its plugins" },
      { name: "Add plugin to profile", value: "plugin-add", description: "Add a plugin to an existing profile" },
      { name: "Remove plugin from profile", value: "plugin-remove", description: "Remove a plugin from a profile" },
      { name: "List profile plugins", value: "plugin-list", description: "Show plugins in a profile" },
      { name: "Create new profile", value: "add", description: "Create a new empty profile" },
      { name: "Delete profile", value: "remove", description: "Remove a profile" },
      { name: "List all profiles", value: "list", description: "Show all profiles" },
      { name: "Search plugins", value: "search", description: "Search plugins in marketplaces" },
    ],
  })) as string;

  switch (action) {
    case "install": {
      const names = getProfileNames();
      if (names.length === 0) {
        console.log(pc.yellow("No profiles found."));
        return;
      }
      const name = await select({
        message: "Select profile to install:",
        choices: names.map((n) => ({ name: n, value: n })),
      });
      await executeProfile(name as string);
      break;
    }
    case "plugin-add": {
      const names = getProfileNames();
      if (names.length === 0) {
        console.log(pc.yellow("No profiles found. Create one first."));
        return;
      }
      const name = (await select({
        message: "Select profile:",
        choices: names.map((n) => ({ name: n, value: n })),
      })) as string;
      await addPlugin(name);
      break;
    }
    case "plugin-remove": {
      const names = getProfileNames();
      if (names.length === 0) {
        console.log(pc.yellow("No profiles found."));
        return;
      }
      const name = (await select({
        message: "Select profile:",
        choices: names.map((n) => ({ name: n, value: n })),
      })) as string;
      await removePlugin(name);
      break;
    }
    case "plugin-list": {
      const names = getProfileNames();
      if (names.length === 0) {
        console.log(pc.yellow("No profiles found."));
        return;
      }
      const name = (await select({
        message: "Select profile:",
        choices: names.map((n) => ({ name: n, value: n })),
      })) as string;
      await listPlugins(name);
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
}

function printHelp() {
  console.log(`${pc.bold("ccx")} — Agent Profile Manager for Claude Code

${pc.bold("Usage:")}
  ${pc.cyan("ccx")}                           Interactive mode
  ${pc.cyan("ccx")} <profile>                  Install all plugins from profile
  ${pc.cyan("ccx add")} <name>                 Create a new profile
  ${pc.cyan("ccx remove")} <name>              Remove a profile
  ${pc.cyan("ccx list")}                       List all profiles
  ${pc.cyan("ccx search")} <keyword>           Search plugins in marketplaces
  ${pc.cyan("ccx <profile> add")} [plugin]     Add plugin to profile
  ${pc.cyan("ccx <profile> remove")} [plugin]  Remove plugin from profile
  ${pc.cyan("ccx <profile> list")}             List plugins in profile`);
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
      console.error(pc.red(`Unknown command: ccx ${args.join(" ")}`));
      printHelp();
      process.exit(1);
    }
    break;
  }
}
