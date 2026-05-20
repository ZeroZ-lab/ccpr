#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const PROFILES_DIR = path.join(process.env.HOME!, ".ccx", "profiles");

function ensureProfilesDir() {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

function profilePath(name: string) {
  return path.join(PROFILES_DIR, `${name}.json`);
}

function readProfile(name: string) {
  const file = profilePath(name);
  if (!fs.existsSync(file)) {
    console.error(`Profile "${name}" not found.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function writeProfile(name: string, data: { name: string; plugins: string[] }) {
  ensureProfilesDir();
  fs.writeFileSync(profilePath(name), JSON.stringify(data, null, 2) + "\n");
}

function addProfile(name: string) {
  const file = profilePath(name);
  if (fs.existsSync(file)) {
    console.error(`Profile "${name}" already exists.`);
    process.exit(1);
  }
  writeProfile(name, { name, plugins: [] });
  console.log(`Created profile "${name}".`);
}

function removeProfile(name: string) {
  const file = profilePath(name);
  if (!fs.existsSync(file)) {
    console.error(`Profile "${name}" not found.`);
    process.exit(1);
  }
  fs.unlinkSync(file);
  console.log(`Removed profile "${name}".`);
}

function listProfiles() {
  ensureProfilesDir();
  const files = fs.readdirSync(PROFILES_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("No profiles found.");
    return;
  }
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, f), "utf-8"));
    console.log(`  ${data.name} (${data.plugins.length} plugins)`);
  }
}

function addPlugin(profileName: string, plugin: string) {
  const data = readProfile(profileName);
  if (data.plugins.includes(plugin)) {
    console.error(`Plugin "${plugin}" already in profile "${profileName}".`);
    process.exit(1);
  }
  data.plugins.push(plugin);
  writeProfile(profileName, data);
  console.log(`Added "${plugin}" to profile "${profileName}".`);
}

function removePlugin(profileName: string, plugin: string) {
  const data = readProfile(profileName);
  const idx = data.plugins.indexOf(plugin);
  if (idx === -1) {
    console.error(`Plugin "${plugin}" not found in profile "${profileName}".`);
    process.exit(1);
  }
  data.plugins.splice(idx, 1);
  writeProfile(profileName, data);
  console.log(`Removed "${plugin}" from profile "${profileName}".`);
}

function listPlugins(profileName: string) {
  const data = readProfile(profileName);
  if (data.plugins.length === 0) {
    console.log(`No plugins in profile "${profileName}".`);
    return;
  }
  for (const p of data.plugins) {
    console.log(`  ${p}`);
  }
}

function executeProfile(profileName: string) {
  const data = readProfile(profileName);
  if (data.plugins.length === 0) {
    console.log(`No plugins to install in profile "${profileName}".`);
    return;
  }
  console.log(`Installing ${data.plugins.length} plugins from profile "${profileName}"...`);
  for (const plugin of data.plugins) {
    console.log(`  Installing ${plugin}...`);
    try {
      execSync(`claude plugin install ${plugin} --scope project`, {
        stdio: "inherit",
      });
    } catch {
      console.error(`  Failed to install ${plugin}.`);
    }
  }
  console.log("Done.");
}

function searchPlugins(keyword: string) {
  const marketplacesDir = path.join(process.env.HOME!, ".claude", "plugins", "marketplaces");
  if (!fs.existsSync(marketplacesDir)) {
    console.log("No marketplaces found.");
    return;
  }
  const lower = keyword.toLowerCase();
  const dirs = fs.readdirSync(marketplacesDir);
  let found = 0;
  for (const dir of dirs) {
    const file = path.join(marketplacesDir, dir, ".claude-plugin", "marketplace.json");
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    for (const p of data.plugins || []) {
      if (
        p.name?.toLowerCase().includes(lower) ||
        p.description?.toLowerCase().includes(lower) ||
        p.category?.toLowerCase().includes(lower)
      ) {
        found++;
        console.log(`  ${p.name}  (${data.name})  ${p.description?.slice(0, 80) || ""}`);
      }
    }
  }
  if (found === 0) {
    console.log(`No plugins matching "${keyword}".`);
  }
}

function printHelp() {
  console.log(`Usage:
  ccx add <profile>                    Create a new profile
  ccx remove <profile>                 Remove a profile
  ccx list                             List all profiles
  ccx search <keyword>                 Search plugins in all marketplaces
  ccx <profile>                        Install all plugins from profile
  ccx <profile> add <plugin|url>       Add plugin to profile
  ccx <profile> remove <plugin|url>    Remove plugin from profile
  ccx <profile> list                   List plugins in profile`);
}

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  printHelp();
  process.exit(0);
}

const cmd = args[0];

switch (cmd) {
  case "add":
    if (!args[1]) {
      console.error("Usage: ccx add <profile>");
      process.exit(1);
    }
    addProfile(args[1]);
    break;

  case "remove":
    if (!args[1]) {
      console.error("Usage: ccx remove <profile>");
      process.exit(1);
    }
    removeProfile(args[1]);
    break;

  case "list":
    listProfiles();
    break;

  case "search":
    if (!args[1]) {
      console.error("Usage: ccx search <keyword>");
      process.exit(1);
    }
    searchPlugins(args[1]);
    break;

  default: {
    // cmd is a profile name
    const profileName = cmd;
    const sub = args[1];

    if (!sub) {
      executeProfile(profileName);
    } else if (sub === "add") {
      if (!args[2]) {
        console.error("Usage: ccx <profile> add <plugin|url>");
        process.exit(1);
      }
      addPlugin(profileName, args[2]);
    } else if (sub === "remove") {
      if (!args[2]) {
        console.error("Usage: ccx <profile> remove <plugin|url>");
        process.exit(1);
      }
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
