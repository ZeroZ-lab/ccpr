#!/usr/bin/env node
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { parseQualifiedPluginReference } from "./domain.js";
import {
  applyProject,
  commitProjectImport,
  createProfile,
  initializeEmptyProject,
  initializeProjectFromProfile,
  inspectProject,
  listCatalogPlugins,
  listProfileSummaries,
  prepareProjectImport,
  removeProfileTemplate,
  searchCatalogPlugins,
  updateProjectManifest,
  updateProfile,
} from "./application.js";
import { createClaudePluginClient } from "./claude-cli.js";
import {
  routeProjectDiff,
  routeProjectInit,
  routeProjectImport,
  routeProjectUp,
  routePluginCommand,
  routeProfileCommand,
} from "./presentation.js";
import {
  createManifestStore,
  createMarketplaceCatalogStore,
  createProfileStore,
} from "./stores.js";

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

function warnLegacyPluginReferences(plugins: readonly string[]) {
  const legacy = plugins.filter(
    (plugin) => !parseQualifiedPluginReference(plugin).ok,
  );
  if (legacy.length === 0) return;
  console.error(
    `Legacy unqualified Plugin Reference${legacy.length === 1 ? "" : "s"}: ${legacy.join(", ")}. Replace with plugin@marketplace before the legacy compatibility window ends.`,
  );
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
    process.exitCode = 1;
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
    if (name) process.exitCode = 1;
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
    process.exitCode = 1;
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
    process.exitCode = 1;
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
    process.exitCode = 1;
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
  warnLegacyPluginReferences(data.plugins);
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
  if (!canPrompt()) {
    let installed = 0;
    let failed = 0;
    for (const plugin of plugins) {
      try {
        execFileSync("claude", ["plugin", "install", plugin, "--scope", "project"], {
          stdio: "pipe",
        });
        installed++;
        console.log(`Installed ${plugin}`);
      } catch {
        failed++;
        console.error(`Failed to install ${plugin}`);
      }
    }
    console.log(`${installed} installed${failed > 0 ? `, ${failed} failed` : ""}`);
    if (failed > 0) process.exitCode = 1;
    return;
  }

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
  if (failed > 0) process.exitCode = 1;
  else p.log.success("Done.");
}

async function executeProfile(profileName: string) {
  const normalizedProfileName = normalizeProfileName(profileName);
  if (!normalizedProfileName) return;

  const data = readProfile(normalizedProfileName);
  if (data.plugins.length === 0) {
    p.log.warn(`No plugins to install in profile "${normalizedProfileName}".`);
    return;
  }

  warnLegacyPluginReferences(data.plugins);
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
    pc.bold("ccx") + pc.dim(" - Project Plugin Environment  ") + pc.gray(`v${pkg.version}`),
  );
}

function renderPluginReferences(plugins: readonly string[]): string {
  return plugins.length === 0
    ? pc.dim("  (none)")
    : plugins.map((plugin) => `  ${pc.dim("•")} ${plugin}`).join("\n");
}

async function interactiveProfiles() {
  const store = createProfileStore(process.env.HOME!);
  while (true) {
    const profiles = listProfileSummaries(store);
    if (!profiles.ok) {
      p.log.error(profiles.error.message);
      return;
    }
    const selected = await p.select({
      message: "Profiles:",
      options: [
        ...profiles.value.map((profile) => ({
          value: profile.name,
          label: profile.name,
          hint: `${profile.pluginCount} plugins`,
        })),
        { value: "__create__", label: "Create empty profile" },
        { value: "__from_project__", label: "Create from Project Manifest" },
        { value: "__back__", label: "Back" },
      ],
    });
    if (p.isCancel(selected) || selected === "__back__") return;

    if (selected === "__create__" || selected === "__from_project__") {
      const name = await p.text({ message: "Profile name:" });
      if (p.isCancel(name)) continue;
      const created = createProfile(
        name,
        selected === "__from_project__"
          ? {
              kind: "project",
              projectRoot: process.cwd(),
              manifestStore: createManifestStore(),
            }
          : { kind: "empty" },
        store,
      );
      if (created.ok) {
        p.log.success(`Created profile ${JSON.stringify(name)}.`);
      } else {
        p.log.error(created.error.message);
      }
      continue;
    }

    const name = selected as string;
    const profile = store.read(name);
    if (!profile.ok) {
      p.log.error(profile.error.message);
      continue;
    }
    p.note(renderPluginReferences(profile.value.plugins), name);
    const action = await p.select({
      message: `Profile ${name}:`,
      options: [
        { value: "add", label: "Add Plugin Reference" },
        { value: "remove", label: "Remove Plugin Reference" },
        { value: "delete", label: "Delete profile" },
        { value: "back", label: "Back" },
      ],
    });
    if (p.isCancel(action) || action === "back") continue;

    if (action === "add") {
      const reference = await p.text({
        message: "Plugin Reference (plugin@marketplace):",
      });
      if (p.isCancel(reference)) continue;
      const updated = updateProfile(
        name,
        { kind: "add", reference },
        store,
      );
      if (updated.ok) p.log.success(`Added ${reference}.`);
      else p.log.error(updated.error.message);
    } else if (action === "remove") {
      if (profile.value.plugins.length === 0) {
        p.log.warn("Profile is empty.");
        continue;
      }
      const reference = await p.select({
        message: "Remove Plugin Reference:",
        options: profile.value.plugins.map((plugin) => ({
          value: plugin,
          label: plugin,
        })),
      });
      if (p.isCancel(reference)) continue;
      const updated = updateProfile(
        name,
        { kind: "remove", reference: reference as string },
        store,
      );
      if (updated.ok) p.log.success(`Removed ${reference}.`);
      else p.log.error(updated.error.message);
    } else {
      const confirmed = await p.confirm({
        message: `Delete profile ${JSON.stringify(name)}?`,
        initialValue: false,
      });
      if (p.isCancel(confirmed) || !confirmed) continue;
      const removed = removeProfileTemplate(name, store);
      if (removed.ok) p.log.success(`Removed profile ${JSON.stringify(name)}.`);
      else p.log.error(removed.error.message);
    }
  }
}

function showPluginCatalog() {
  const catalog = listCatalogPlugins(
    createMarketplaceCatalogStore(process.env.HOME!),
  );
  if (!catalog.ok) {
    p.log.error(catalog.error.message);
    return;
  }
  if (catalog.value.length === 0) {
    p.log.warn("No plugins found in installed marketplaces.");
    return;
  }
  p.note(
    catalog.value
      .map((plugin) =>
        `${plugin.reference}${plugin.description ? ` — ${plugin.description}` : ""}`
      )
      .join("\n"),
    "Plugin catalog",
  );
}

async function runInteractiveProjectCommand(args: string[]) {
  const previousExitCode = process.exitCode;
  await main(args);
  process.exitCode = previousExitCode;
}

async function interactiveProjectEdit() {
  const manifestStore = createManifestStore();
  const manifest = manifestStore.read(process.cwd());
  if (!manifest.ok) {
    p.log.error(manifest.error.message);
    return;
  }
  const action = await p.select({
    message: "Edit Project Manifest:",
    options: [
      { value: "add", label: "Add Plugin Reference" },
      { value: "remove", label: "Remove Plugin Reference" },
      { value: "back", label: "Back" },
    ],
  });
  if (p.isCancel(action) || action === "back") return;

  let reference: string;
  if (action === "add") {
    const entered = await p.text({
      message: "Plugin Reference (plugin@marketplace):",
    });
    if (p.isCancel(entered)) return;
    reference = entered;
  } else {
    if (manifest.value.plugins.length === 0) {
      p.log.warn("Project Manifest is empty.");
      return;
    }
    const selected = await p.select({
      message: "Remove Plugin Reference:",
      options: manifest.value.plugins.map((plugin) => ({
        value: plugin,
        label: plugin,
      })),
    });
    if (p.isCancel(selected)) return;
    reference = selected as string;
  }

  const updated = updateProjectManifest(
    process.cwd(),
    { kind: action as "add" | "remove", reference },
    manifestStore,
  );
  if (updated.ok) {
    p.log.success(
      `${action === "add" ? "Added" : "Removed"} ${reference} ${action === "add" ? "to" : "from"} .ccx.json.`,
    );
  } else {
    p.log.error(updated.error.message);
  }
}

async function interactiveMode() {
  if (!canPrompt()) {
    printNonInteractiveHelp();
    process.exitCode = 1;
    return;
  }

  printBanner();
  while (true) {
    const manifestStore = createManifestStore();
    const exists = manifestStore.exists(process.cwd());
    if (!exists.ok) {
      p.log.error(exists.error.message);
      return;
    }

    if (!exists.value) {
      p.note(pc.dim("No .ccx.json in the current directory."), "Current project");
      const action = await p.select({
        message: "Project Plugin Environment:",
        options: [
          { value: "init", label: "Init Project Manifest" },
          { value: "profiles", label: "Profiles" },
          { value: "catalog", label: "Plugin catalog" },
          { value: "exit", label: "Exit" },
        ],
      });
      if (p.isCancel(action) || action === "exit") break;
      if (action === "init") await runInteractiveProjectCommand(["project", "init"]);
      else if (action === "profiles") await interactiveProfiles();
      else showPluginCatalog();
      continue;
    }

    const inspection = inspectProject(process.cwd(), {
      manifestStore,
      claudePluginClient: createClaudePluginClient(),
    });
    if (inspection.ok) {
      p.note(
        `${pc.bold("Missing")}\n${renderPluginReferences(inspection.value.missing)}\n\n${pc.bold("Undeclared")}\n${renderPluginReferences(inspection.value.undeclared)}`,
        "Current project",
      );
    } else {
      p.log.error(inspection.error.message);
    }

    const action = await p.select({
      message: "Project Plugin Environment:",
      options: [
        { value: "up", label: "Up", hint: "Install missing plugins" },
        { value: "diff", label: "Diff", hint: "Show Drift" },
        { value: "edit", label: "Edit", hint: "Change Project Manifest" },
        { value: "import", label: "Import", hint: "Capture Installed State" },
        { value: "profiles", label: "Profiles" },
        { value: "catalog", label: "Plugin catalog" },
        { value: "exit", label: "Exit" },
      ],
    });
    if (p.isCancel(action) || action === "exit") break;
    if (action === "up") await runInteractiveProjectCommand(["project", "up"]);
    else if (action === "diff") await runInteractiveProjectCommand(["project", "diff"]);
    else if (action === "edit") await interactiveProjectEdit();
    else if (action === "import") await runInteractiveProjectCommand(["project", "import"]);
    else if (action === "profiles") await interactiveProfiles();
    else showPluginCatalog();
  }

  p.outro("Done.");
}

function printHelp() {
  const require = createRequire(import.meta.url);
  const pkg = require("../package.json");

  console.log(`${renderLogo()}
${pc.bold("ccx")} ${pc.dim("- Project Plugin Environment for Claude Code")}  ${pc.gray(`v${pkg.version}`)}

${pc.bold("Usage:")}
  ${pc.cyan("ccx")}                                  Project-first interactive mode (TTY)
  ${pc.cyan("ccx ui")}                               Project-first interactive mode (TTY)

${pc.bold("Project:")}
  ${pc.cyan("ccx project init")} ${pc.dim("(--empty | --from-profile PROFILE) [--force]")}
  ${pc.cyan("ccx project up")}                        Install only Missing plugins
  ${pc.cyan("ccx project diff")}                      Show Missing and Undeclared plugins
  ${pc.cyan("ccx project import")} ${pc.dim("[--yes]")}            Preview and capture Installed State

${pc.bold("Project aliases:")}
  ${pc.cyan("ccx init")} ${pc.dim("...")}                           Alias of ccx project init
  ${pc.cyan("ccx up")}                                 Alias of ccx project up
  ${pc.cyan("ccx diff")}                               Alias of ccx project diff

${pc.bold("Profiles:")}
  ${pc.cyan("ccx profile create")} ${pc.dim("[--from-project] NAME")}
  ${pc.cyan("ccx profile ls")}
  ${pc.cyan("ccx profile inspect")} ${pc.dim("NAME")}
  ${pc.cyan("ccx profile update")} ${pc.dim("(--add PLUGIN | --remove PLUGIN) NAME")}
  ${pc.cyan("ccx profile rm")} ${pc.dim("NAME")}

${pc.bold("Plugins:")}
  ${pc.cyan("ccx plugin ls")}                         List marketplace plugins
  ${pc.cyan("ccx plugin search")} ${pc.dim("KEYWORD")}             Search qualified Plugin References

${pc.bold("Options:")}
  ${pc.cyan("ccx -v, --version")}                    Show version

${pc.bold("Exit status:")}
  ${pc.dim("0 success · 1 usage/runtime/partial failure · 2 Drift found by diff")}

${pc.dim("ccx 0.1 commands remain available with migration warnings in 0.2;")}
${pc.dim("ambiguous legacy forms are removed in 0.3.")}`);
}

// ── Main ──────────────────────────────────────────────────

function warnDeprecated(invocation: string, replacement: string) {
  process.stderr.write(
    `Deprecated in ccx 0.2: ${invocation}. Use ${replacement}. The ambiguous form will be removed in ccx 0.3.\n`,
  );
}

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

  const profileStore = createProfileStore(process.env.HOME!);
  const profileCommandStatus = routeProfileCommand(args, {
    create: (name, fromProject) =>
      createProfile(
        name,
        fromProject
          ? {
              kind: "project",
              projectRoot: process.cwd(),
              manifestStore: createManifestStore(),
            }
          : { kind: "empty" },
        profileStore,
      ),
    list: () => listProfileSummaries(profileStore),
    inspect: (name) => profileStore.read(name),
    update: (name, change) => updateProfile(name, change, profileStore),
    remove: (name) => removeProfileTemplate(name, profileStore),
    writeStdout: (output) => process.stdout.write(output),
    writeStderr: (output) => process.stderr.write(output),
  });
  if (profileCommandStatus !== undefined) {
    process.exitCode = profileCommandStatus;
    return;
  }

  const catalogStore = createMarketplaceCatalogStore(process.env.HOME!);
  const pluginCommandStatus = routePluginCommand(args, {
    list: () => listCatalogPlugins(catalogStore),
    search: (keyword) => searchCatalogPlugins(keyword, catalogStore),
    writeStdout: (output) => process.stdout.write(output),
    writeStderr: (output) => process.stderr.write(output),
  });
  if (pluginCommandStatus !== undefined) {
    process.exitCode = pluginCommandStatus;
    return;
  }

  const projectInitStatus = await routeProjectInit(args, {
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
    isInteractive: canPrompt(),
    chooseSource: async () => {
      const names = profileStore.list();
      if (!names.ok) {
        process.stderr.write(`${names.error.message}\n`);
        return undefined;
      }
      const source = await p.select({
        message: "Initialize Project Manifest:",
        options: [
          { value: "__empty__", label: "Empty manifest" },
          ...names.value.map((name) => ({
            value: name,
            label: `From profile: ${name}`,
          })),
        ],
      });
      if (p.isCancel(source)) return undefined;
      return source === "__empty__"
        ? { kind: "empty" as const }
        : { kind: "profile" as const, name: source as string };
    },
    confirmOverwrite: async () => {
      const overwrite = await p.confirm({
        message: ".ccx.json already exists. Overwrite?",
        initialValue: false,
      });
      return !p.isCancel(overwrite) && overwrite;
    },
    writeStdout: (output) => process.stdout.write(output),
    writeStderr: (output) => process.stderr.write(output),
  });
  if (projectInitStatus !== undefined) {
    process.exitCode = projectInitStatus;
    return;
  }

  const projectImportStatus = await routeProjectImport(args, {
    projectRoot: process.cwd(),
    prepare: (projectRoot) =>
      prepareProjectImport(projectRoot, {
        manifestStore: createManifestStore(),
        claudePluginClient: createClaudePluginClient(),
      }),
    commit: (projectRoot, preview) =>
      commitProjectImport(projectRoot, preview, createManifestStore()),
    isInteractive: canPrompt(),
    confirm: async () => {
      const confirmed = await p.confirm({
        message: "Write this Installed State to .ccx.json?",
        initialValue: false,
      });
      return !p.isCancel(confirmed) && confirmed;
    },
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
    case "sync": {
      warnDeprecated("ccx sync", "ccx project import --yes");
      const status = await routeProjectImport(
        ["project", "import", "--yes"],
        {
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
        },
      );
      process.exitCode = status;
      return;
    }

    case "save":
      warnDeprecated(
        `ccx save${args[1] ? ` ${args[1]}` : ""}`,
        `ccx profile create --from-project${args[1] ? ` ${args[1]}` : " NAME"}`,
      );
      await saveToProfile(args[1]);
      break;

    case "tui":
    case "interactive":
      warnDeprecated(`ccx ${cmd}`, "ccx ui");
      await interactiveMode();
      break;

    case "ui":
      await interactiveMode();
      break;

    case "install": {
      if (!args[1]) {
        warnDeprecated("ccx install", "ccx project up");
        const status = routeProjectUp(["project", "up"], {
          projectRoot: process.cwd(),
          apply: (projectRoot) =>
            applyProject(projectRoot, {
              manifestStore: createManifestStore(),
              claudePluginClient: createClaudePluginClient(),
            }),
          writeStdout: (output) => process.stdout.write(output),
          writeStderr: (output) => process.stderr.write(output),
        });
        process.exitCode = status;
        return;
      }
      warnDeprecated(
        `ccx install ${args[1]}`,
        `ccx project init --from-profile ${args[1]} && ccx project up`,
      );
      await executeProfile(args[1]);
      break;
    }

    case "create":
      warnDeprecated(
        `ccx create${args[1] ? ` ${args[1]}` : ""}`,
        `ccx profile create${args[1] ? ` ${args[1]}` : " NAME"}`,
      );
      await addProfile(args[1]);
      break;

    case "delete":
      warnDeprecated(
        `ccx delete${args[1] ? ` ${args[1]}` : ""}`,
        `ccx profile rm${args[1] ? ` ${args[1]}` : " NAME"}`,
      );
      await removeProfile(args[1]);
      break;

    case "profiles":
      warnDeprecated("ccx profiles", "ccx profile ls");
      await listProfiles();
      break;

    case "add":
      if (args[2]) {
        warnDeprecated(
          `ccx add ${args[1]} ${args[2]}`,
          `ccx profile update --add ${args[2]} ${args[1]}`,
        );
        await addPlugin(args[1], args[2]);
      } else {
        warnDeprecated(
          `ccx add${args[1] ? ` ${args[1]}` : ""}`,
          `ccx profile create${args[1] ? ` ${args[1]}` : " NAME"}`,
        );
        await addProfile(args[1]);
      }
      break;

    case "remove":
      if (args[2]) {
        warnDeprecated(
          `ccx remove ${args[1]} ${args[2]}`,
          `ccx profile update --remove ${args[2]} ${args[1]}`,
        );
        await removePlugin(args[1], args[2]);
      } else {
        warnDeprecated(
          `ccx remove${args[1] ? ` ${args[1]}` : ""}`,
          `ccx profile rm${args[1] ? ` ${args[1]}` : " NAME"}`,
        );
        await removeProfile(args[1]);
      }
      break;

    case "list":
      if (args[1]) {
        warnDeprecated(
          `ccx list ${args[1]}`,
          `ccx profile inspect ${args[1]}`,
        );
        await listPlugins(args[1]);
      } else {
        warnDeprecated("ccx list", "ccx profile ls");
        await listProfiles();
      }
      break;

    case "search": {
      warnDeprecated(
        `ccx search${args[1] ? ` ${args[1]}` : ""}`,
        `ccx plugin search${args[1] ? ` ${args[1]}` : " KEYWORD"}`,
      );
      const status = routePluginCommand(
        ["plugin", "search", ...(args[1] ? [args[1]] : [])],
        {
          list: () => listCatalogPlugins(catalogStore),
          search: (keyword) => searchCatalogPlugins(keyword, catalogStore),
          writeStdout: (output) => process.stdout.write(output),
          writeStderr: (output) => process.stderr.write(output),
        },
      );
      process.exitCode = status;
      return;
    }

    default: {
      if (cmd === "project") {
        console.error(`Unknown project command: ccx ${args.join(" ")}`);
        console.error("Usage: ccx project <init|up|diff|import> ...");
        process.exitCode = 1;
        return;
      }
      const profileName = cmd;
      const sub = args[1];

      if (!sub) {
        warnDeprecated(
          `ccx ${profileName}`,
          `ccx project init --from-profile ${profileName} && ccx project up`,
        );
        await executeProfile(profileName);
      } else if (sub === "add") {
        warnDeprecated(
          `ccx ${profileName} add${args[2] ? ` ${args[2]}` : ""}`,
          `ccx profile update --add${args[2] ? ` ${args[2]}` : " PLUGIN"} ${profileName}`,
        );
        await addPlugin(profileName, args[2]);
      } else if (sub === "remove") {
        warnDeprecated(
          `ccx ${profileName} remove${args[2] ? ` ${args[2]}` : ""}`,
          `ccx profile update --remove${args[2] ? ` ${args[2]}` : " PLUGIN"} ${profileName}`,
        );
        await removePlugin(profileName, args[2]);
      } else if (sub === "list") {
        warnDeprecated(
          `ccx ${profileName} list`,
          `ccx profile inspect ${profileName}`,
        );
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
