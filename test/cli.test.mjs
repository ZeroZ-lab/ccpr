import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bin = path.join(repoRoot, "dist", "index.js");

function run(args, home, cwd, env = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: cwd || repoRoot,
    env: {
      ...process.env,
      HOME: home,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      ...env,
    },
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function installFakeClaude(home, list, install = {}) {
  const binDir = path.join(home, "bin");
  const configPath = path.join(home, "fake-claude.json");
  const logPath = path.join(home, "fake-claude-calls.jsonl");
  const executable = path.join(binDir, "claude");

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ list, install }));
  fs.writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require("node:fs");
const config = JSON.parse(fs.readFileSync(process.env.CCX_FAKE_CLAUDE_CONFIG, "utf8"));
const args = process.argv.slice(2);
fs.appendFileSync(
  process.env.CCX_FAKE_CLAUDE_LOG,
  JSON.stringify({ args, cwd: process.cwd() }) + "\\n",
);
let outcome;
if (args.join(" ") === "plugin list --json") {
  outcome = config.list;
} else if (
  args.length === 5 &&
  args[0] === "plugin" &&
  args[1] === "install" &&
  args[3] === "--scope" &&
  args[4] === "project" &&
  Object.prototype.hasOwnProperty.call(config.install, args[2])
) {
  outcome = config.install[args[2]];
} else {
  process.stderr.write("Unexpected fake Claude invocation: " + args.join(" "));
  process.exit(64);
}
process.stdout.write(outcome.stdout || "");
process.stderr.write(outcome.stderr || "");
process.exit(outcome.status ?? 0);
`,
  );
  fs.chmodSync(executable, 0o755);

  return {
    env: {
      CCX_FAKE_CLAUDE_CONFIG: configPath,
      CCX_FAKE_CLAUDE_LOG: logPath,
      PATH: [binDir, path.dirname(process.execPath), process.env.PATH]
        .filter(Boolean)
        .join(path.delimiter),
    },
    readCalls() {
      if (!fs.existsSync(logPath)) return [];
      return fs
        .readFileSync(logPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
  };
}

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-test-"));
  try {
    fn(home);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

withHome((home) => {
  const result = run([], home);

  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /Interactive mode requires a TTY/);
  assert.doesNotMatch(result.stdout + result.stderr, /What do you want to do/);
});

withHome((home) => {
  const result = run(["delete"], home);

  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /Profile name is required/);
});

withHome((home) => {
  const result = run(["create", "../outside"], home);

  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /Invalid profile name/);
  assert.equal(fs.existsSync(path.join(home, "..", "outside.json")), false);
});

withHome((home) => {
  const profileDir = path.join(home, ".ccx", "profiles");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(
    path.join(profileDir, "dev.json"),
    JSON.stringify({ name: "dev", plugins: "plugin-a" })
  );

  const result = run(["list", "dev"], home);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /Invalid profile file/);

  const profiles = run(["profiles"], home);
  assert.equal(profiles.status, 1);
  assert.match(profiles.stdout + profiles.stderr, /Invalid profile file/);
});

withHome((home) => {
  const marketplaceDir = path.join(
    home,
    ".claude",
    "plugins",
    "marketplaces",
    "bad",
    ".claude-plugin"
  );
  fs.mkdirSync(marketplaceDir, { recursive: true });
  fs.writeFileSync(path.join(marketplaceDir, "marketplace.json"), "{bad json");

  const result = run(["search", "plugin"], home);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "No plugins found.\n");
  assert.doesNotMatch(result.stderr, /Skipping invalid marketplace/);
  assert.match(result.stderr, /Use ccx plugin search plugin/);
});

withHome((home) => {
  const created = run(["create", "dev"], home);
  assert.equal(created.status, 0);
  assert.match(created.stderr, /Use ccx profile create dev/);

  const profiles = run(["profiles"], home);
  assert.equal(profiles.status, 0);
  assert.match(profiles.stdout + profiles.stderr, /dev\s+\(0 plugins\)/);
  assert.match(profiles.stderr, /Use ccx profile ls/);

  const added = run(["add", "dev", "plugin-a"], home);
  assert.equal(added.status, 0);
  assert.match(
    added.stderr,
    /Use ccx profile update --add plugin-a dev/,
  );

  const plugins = run(["list", "dev"], home);
  assert.equal(plugins.status, 0);
  assert.match(plugins.stdout + plugins.stderr, /plugin-a/);
  assert.match(plugins.stderr, /Use ccx profile inspect dev/);

  const legacyPlugins = run(["dev", "list"], home);
  assert.equal(legacyPlugins.status, 0);
  assert.match(legacyPlugins.stdout + legacyPlugins.stderr, /plugin-a/);
  assert.match(legacyPlugins.stderr, /Use ccx profile inspect dev/);

  const legacyAdded = run(["dev", "add", "plugin-b"], home);
  assert.equal(legacyAdded.status, 0);
  assert.match(
    legacyAdded.stderr,
    /Use ccx profile update --add plugin-b dev/,
  );

  const removedTopLevel = run(["remove", "dev", "plugin-a"], home);
  assert.equal(removedTopLevel.status, 0);
  assert.match(
    removedTopLevel.stderr,
    /Use ccx profile update --remove plugin-a dev/,
  );

  const removedPlugin = run(["dev", "remove", "plugin-b"], home);
  assert.equal(removedPlugin.status, 0);
  assert.match(
    removedPlugin.stderr,
    /Use ccx profile update --remove plugin-b dev/,
  );

  const directProfile = run(["dev"], home);
  assert.equal(directProfile.status, 0);
  assert.match(directProfile.stderr, /Use ccx project init --from-profile dev/);

  const installedProfile = run(["install", "dev"], home);
  assert.equal(installedProfile.status, 0);
  assert.match(
    installedProfile.stderr,
    /Use ccx project init --from-profile dev.*ccx project up/,
  );

  const createdByAlias = run(["add", "personal"], home);
  assert.equal(createdByAlias.status, 0);
  assert.match(createdByAlias.stderr, /Use ccx profile create personal/);
  const removedByAlias = run(["remove", "personal"], home);
  assert.equal(removedByAlias.status, 0);
  assert.match(removedByAlias.stderr, /Use ccx profile rm personal/);

  const listedByAlias = run(["list"], home);
  assert.equal(listedByAlias.status, 0);
  assert.match(listedByAlias.stderr, /Use ccx profile ls/);

  const deleted = run(["delete", "dev"], home);
  assert.equal(deleted.status, 0);
  assert.match(deleted.stderr, /Use ccx profile rm dev/);
});

withHome((home) => {
  for (const alias of ["tui", "interactive"]) {
    const result = run([alias], home);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`Deprecated.*ccx ${alias}`));
    assert.match(result.stderr, /Use ccx ui/);
  }

  const unknownProject = run(["project"], home);
  assert.equal(unknownProject.status, 1);
  assert.match(unknownProject.stderr, /Usage: ccx project/);
  assert.doesNotMatch(unknownProject.stderr, /Profile "project" not found/);

  for (const object of ["profile", "plugin"]) {
    const result = run([object], home);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`Usage: ccx ${object}`));
    assert.doesNotMatch(result.stderr, new RegExp(`Profile "${object}"`));
  }
});

withHome((home) => {
  const profileDir = path.join(home, ".ccx", "profiles");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(
    path.join(profileDir, "legacy-install.json"),
    JSON.stringify({
      name: "legacy-install",
      plugins: ["formatter@official"],
    }),
  );
  const claude = installFakeClaude(
    home,
    { stdout: "[]" },
    { "formatter@official": { status: 0 } },
  );
  const result = run(
    ["install", "legacy-install"],
    home,
    undefined,
    claude.env,
  );

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout, "Installed formatter@official\n1 installed\n");
  assert.doesNotMatch(result.stdout + result.stderr, /\u001b\[/);
});

withHome((home) => {
  const noProfiles = run(["delete", "missing"], home);
  assert.equal(noProfiles.status, 1);
  assert.match(noProfiles.stdout + noProfiles.stderr, /No profiles found/);

  assert.equal(run(["create", "dev"], home).status, 0);

  const duplicate = run(["create", "dev"], home);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stdout + duplicate.stderr, /already exists/);

  const missingProfile = run(["delete", "missing"], home);
  assert.equal(missingProfile.status, 1);
  assert.match(missingProfile.stdout + missingProfile.stderr, /not found/);

  const emptyProfileRemoval = run(["remove", "dev", "plugin-b"], home);
  assert.equal(emptyProfileRemoval.status, 1);
  assert.match(
    emptyProfileRemoval.stdout + emptyProfileRemoval.stderr,
    /No plugins in this profile/,
  );

  assert.equal(run(["add", "dev", "plugin-a"], home).status, 0);
  const missingPlugin = run(["remove", "dev", "plugin-b"], home);
  assert.equal(missingPlugin.status, 1);
  assert.match(missingPlugin.stdout + missingPlugin.stderr, /not found/);
});

// ── Project config tests (.ccx.json) ─────────────────────

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-init-"));
  try {
    const result = run(["project", "init", "--empty"], home, cwd);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "Created .ccx.json with 0 plugins.\n");
    assert.equal(
      fs.readFileSync(path.join(cwd, ".ccx.json"), "utf8"),
      '{\n  "plugins": []\n}\n',
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-import-"));
  try {
    const manifestPath = path.join(cwd, ".ccx.json");
    const original =
      '{\n  "plugins": ["keep@official", "remove@official"]\n}\n';
    fs.writeFileSync(manifestPath, original);
    const claude = installFakeClaude(home, {
      stdout: JSON.stringify([
        { id: "added@official", scope: "project", projectPath: cwd },
        { id: "keep@official", scope: "project", projectPath: cwd },
      ]),
    });

    const result = run(["project", "import"], home, cwd, claude.env);

    assert.equal(result.status, 1);
    assert.equal(
      result.stdout,
      "Added:\n  added@official\nRemoved:\n  remove@official\n",
    );
    assert.match(result.stderr, /requires --yes/i);
    assert.equal(fs.readFileSync(manifestPath, "utf8"), original);
    assert.deepEqual(claude.readCalls(), [
      { args: ["plugin", "list", "--json"], cwd: fs.realpathSync(cwd) },
    ]);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-sync-"));
  try {
    fs.writeFileSync(
      path.join(cwd, ".ccx.json"),
      JSON.stringify({ plugins: ["old@official"] }),
    );
    const claude = installFakeClaude(home, {
      stdout: JSON.stringify([
        { id: "new@official", scope: "project", projectPath: cwd },
      ]),
    });
    const result = run(["sync"], home, cwd, claude.env);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /Use ccx project import --yes/);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(cwd, ".ccx.json"), "utf8")),
      { plugins: ["new@official"] },
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-import-"));
  try {
    const claude = installFakeClaude(home, {
      stdout: JSON.stringify([
        { id: "zeta@official", scope: "project", projectPath: cwd },
        { id: "alpha@official", scope: "project", projectPath: cwd },
        { id: "zeta@official", scope: "project", projectPath: cwd },
      ]),
    });

    const result = run(
      ["project", "import", "--yes"],
      home,
      cwd,
      claude.env,
    );

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(
      result.stdout,
      "Added:\n  zeta@official\n  alpha@official\nRemoved:\n  (none)\nImported .ccx.json with 2 plugins.\n",
    );
    assert.equal(
      fs.readFileSync(path.join(cwd, ".ccx.json"), "utf8"),
      '{\n  "plugins": [\n    "zeta@official",\n    "alpha@official"\n  ]\n}\n',
    );
    assert.equal(claude.readCalls().length, 1);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-import-"));
  try {
    const manifestPath = path.join(cwd, ".ccx.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ plugins: ["remove@official"] }),
    );
    const claude = installFakeClaude(home, { stdout: "[]" });

    const result = run(
      ["project", "import", "--yes"],
      home,
      cwd,
      claude.env,
    );

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(
      result.stdout,
      "Added:\n  (none)\nRemoved:\n  remove@official\nImported .ccx.json with 0 plugins.\n",
    );
    assert.equal(
      fs.readFileSync(manifestPath, "utf8"),
      '{\n  "plugins": []\n}\n',
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-import-"));
  try {
    const manifestPath = path.join(cwd, ".ccx.json");
    const original = '{"plugins":["keep@official"]}\n';
    fs.writeFileSync(manifestPath, original);
    const claude = installFakeClaude(home, { stdout: "{bad json" });

    const result = run(
      ["project", "import", "--yes"],
      home,
      cwd,
      claude.env,
    );

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Claude returned invalid JSON/);
    assert.equal(fs.readFileSync(manifestPath, "utf8"), original);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-init-"));
  try {
    const profileDir = path.join(home, ".ccx", "profiles");
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(
      path.join(profileDir, "work.json"),
      JSON.stringify({
        name: "work",
        plugins: ["zeta@official", "alpha@official", "zeta@official"],
      }),
    );

    const result = run(
      ["project", "init", "--from-profile", "work"],
      home,
      cwd,
    );

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "Created .ccx.json with 2 plugins.\n");
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(cwd, ".ccx.json"), "utf8")),
      { plugins: ["zeta@official", "alpha@official"] },
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-init-"));
  try {
    const profileDir = path.join(home, ".ccx", "profiles");
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(
      path.join(profileDir, "legacy.json"),
      JSON.stringify({ name: "legacy", plugins: ["bare-plugin"] }),
    );

    const result = run(
      ["project", "init", "--from-profile", "legacy"],
      home,
      cwd,
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid qualified Plugin Reference/);
    assert.equal(fs.existsSync(path.join(cwd, ".ccx.json")), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-init-"));
  try {
    const manifestPath = path.join(cwd, ".ccx.json");
    fs.writeFileSync(manifestPath, '{"plugins":["old@official"]}\n');

    const result = run(
      ["project", "init", "--empty", "--force"],
      home,
      cwd,
    );

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(
      fs.readFileSync(manifestPath, "utf8"),
      '{\n  "plugins": []\n}\n',
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-init-"));
  try {
    const result = run(["project", "init"], home, cwd);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(
      result.stderr,
      /Usage: ccx project init \(--empty \| --from-profile PROFILE\)/,
    );
    assert.equal(fs.existsSync(path.join(cwd, ".ccx.json")), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-init-"));
  try {
    const manifestPath = path.join(cwd, ".ccx.json");
    const original = '{"plugins":["keep@official"]}\n';
    fs.writeFileSync(manifestPath, original);

    const result = run(["project", "init", "--empty"], home, cwd);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /\.ccx\.json already exists.*--force/i);
    assert.equal(fs.readFileSync(manifestPath, "utf8"), original);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-init-"));
  try {
    const result = run(["init", "--empty"], home, cwd);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(
      fs.readFileSync(path.join(cwd, ".ccx.json"), "utf8"),
      '{\n  "plugins": []\n}\n',
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-diff-"));
  try {
    fs.writeFileSync(
      path.join(cwd, ".ccx.json"),
      JSON.stringify({ plugins: ["formatter@official"] }),
    );
    const claude = installFakeClaude(home, {
      stdout: JSON.stringify([
        {
          id: "formatter@official",
          scope: "project",
          projectPath: cwd,
        },
      ]),
    });

    const result = run(["project", "diff"], home, cwd, claude.env);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout, "Missing:\n  (none)\nUndeclared:\n  (none)\n");
    assert.equal(result.stderr, "");
    assert.deepEqual(claude.readCalls(), [
      { args: ["plugin", "list", "--json"], cwd: fs.realpathSync(cwd) },
    ]);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-diff-legacy-"));
  try {
    fs.writeFileSync(
      path.join(cwd, ".ccx.json"),
      JSON.stringify({ plugins: ["legacy-plugin"] }),
    );
    const claude = installFakeClaude(home, { stdout: "[]" });
    const result = run(["project", "diff"], home, cwd, claude.env);

    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stdout, /legacy-plugin/);
    assert.match(result.stderr, /Legacy unqualified Plugin Reference/);
    assert.match(result.stderr, /plugin@marketplace/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-up-"));
  try {
    fs.writeFileSync(
      path.join(cwd, ".ccx.json"),
      JSON.stringify({ plugins: ["formatter@official"] }),
    );
    const claude = installFakeClaude(home, {
      stdout: JSON.stringify([
        {
          id: "formatter@official",
          scope: "project",
          projectPath: cwd,
        },
      ]),
    });

    const result = run(["project", "up"], home, cwd, claude.env);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(
      result.stdout,
      "Missing:\n  (none)\nUndeclared:\n  (none)\nInstalled:\n  (none)\nFailed:\n  (none)\n",
    );
    assert.equal(result.stderr, "");
    assert.deepEqual(claude.readCalls(), [
      { args: ["plugin", "list", "--json"], cwd: fs.realpathSync(cwd) },
    ]);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-up-"));
  try {
    fs.writeFileSync(
      path.join(cwd, ".ccx.json"),
      JSON.stringify({
        plugins: ["qualified@official", "legacy-plugin"],
      }),
    );
    const claude = installFakeClaude(
      home,
      { stdout: "[]" },
      {
        "qualified@official": {},
        "legacy-plugin": {},
      },
    );

    const result = run(["project", "up"], home, cwd, claude.env);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /legacy-plugin/);
    assert.match(result.stderr, /Update \.ccx\.json/);
    assert.match(result.stderr, /plugin-name@marketplace-name/);
    assert.deepEqual(claude.readCalls(), [
      { args: ["plugin", "list", "--json"], cwd: fs.realpathSync(cwd) },
    ]);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-up-"));
  try {
    fs.writeFileSync(
      path.join(cwd, ".ccx.json"),
      JSON.stringify({
        plugins: [
          "alpha@official",
          "beta@official",
          "gamma@official",
        ],
      }),
    );
    const claude = installFakeClaude(
      home,
      { stdout: "[]" },
      {
        "alpha@official": {},
        "beta@official": {
          status: 23,
          stdout: "partial install output",
          stderr: "marketplace unavailable",
        },
        "gamma@official": {},
      },
    );

    const result = run(["project", "up"], home, cwd, claude.env);

    assert.equal(result.status, 1);
    assert.equal(
      result.stdout,
      "Missing:\n  alpha@official\n  beta@official\n  gamma@official\nUndeclared:\n  (none)\nInstalled:\n  alpha@official\n  gamma@official\nFailed:\n  beta@official\n",
    );
    assert.match(result.stderr, /Failed beta@official:/);
    assert.match(result.stderr, /exited with status 23/);
    assert.match(result.stderr, /marketplace unavailable/);
    assert.match(result.stderr, /partial install output/);
    assert.doesNotMatch(result.stdout + result.stderr, /Done\./);
    assert.deepEqual(claude.readCalls(), [
      { args: ["plugin", "list", "--json"], cwd: fs.realpathSync(cwd) },
      {
        args: [
          "plugin",
          "install",
          "alpha@official",
          "--scope",
          "project",
        ],
        cwd: fs.realpathSync(cwd),
      },
      {
        args: [
          "plugin",
          "install",
          "beta@official",
          "--scope",
          "project",
        ],
        cwd: fs.realpathSync(cwd),
      },
      {
        args: [
          "plugin",
          "install",
          "gamma@official",
          "--scope",
          "project",
        ],
        cwd: fs.realpathSync(cwd),
      },
    ]);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-up-"));
  try {
    fs.writeFileSync(
      path.join(cwd, ".ccx.json"),
      JSON.stringify({
        plugins: [
          "already@official",
          "zeta@official",
          "alpha@official",
          "zeta@official",
        ],
      }),
    );
    const claude = installFakeClaude(
      home,
      {
        stdout: JSON.stringify([
          {
            id: "already@official",
            scope: "project",
            projectPath: cwd,
          },
          {
            id: "local-only@official",
            scope: "project",
            projectPath: cwd,
          },
        ]),
      },
      {
        "zeta@official": {},
        "alpha@official": {},
      },
    );

    const result = run(["up"], home, cwd, claude.env);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(
      result.stdout,
      "Missing:\n  zeta@official\n  alpha@official\nUndeclared:\n  local-only@official\nInstalled:\n  zeta@official\n  alpha@official\nFailed:\n  (none)\n",
    );
    assert.equal(result.stderr, "");
    assert.deepEqual(claude.readCalls(), [
      { args: ["plugin", "list", "--json"], cwd: fs.realpathSync(cwd) },
      {
        args: [
          "plugin",
          "install",
          "zeta@official",
          "--scope",
          "project",
        ],
        cwd: fs.realpathSync(cwd),
      },
      {
        args: [
          "plugin",
          "install",
          "alpha@official",
          "--scope",
          "project",
        ],
        cwd: fs.realpathSync(cwd),
      },
    ]);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-diff-"));
  try {
    fs.writeFileSync(
      path.join(cwd, ".ccx.json"),
      JSON.stringify({ plugins: [] }),
    );
    const claude = installFakeClaude(home, { stdout: "{bad json" });

    const result = run(["project", "diff"], home, cwd, claude.env);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Claude returned invalid JSON/);
    assert.doesNotMatch(result.stderr, /\n\s+at\s/);
    assert.deepEqual(claude.readCalls(), [
      { args: ["plugin", "list", "--json"], cwd: fs.realpathSync(cwd) },
    ]);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-diff-"));
  const otherProject = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-other-"));
  try {
    const manifestContents = JSON.stringify({
      plugins: [
        "zeta@official",
        "alpha@official",
        "omega@official",
        "zeta@official",
      ],
    });
    fs.writeFileSync(path.join(cwd, ".ccx.json"), manifestContents);
    const claude = installFakeClaude(home, {
      stdout: JSON.stringify([
        { id: "delta@official", scope: "project", projectPath: cwd },
        { id: "zeta@official", scope: "project", projectPath: otherProject },
        { id: "omega@official", scope: "user" },
        { id: "alpha@official", scope: "project", projectPath: `${cwd}/.` },
        { id: "beta@official", scope: "project", projectPath: cwd },
        { id: "beta@official", scope: "project", projectPath: cwd },
      ]),
    });

    const result = run(["diff"], home, cwd, claude.env);

    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.equal(
      result.stdout,
      "Missing:\n  zeta@official\n  omega@official\nUndeclared:\n  beta@official\n  delta@official\n",
    );
    assert.equal(result.stderr, "");
    assert.equal(
      fs.readFileSync(path.join(cwd, ".ccx.json"), "utf8"),
      manifestContents,
    );
    assert.deepEqual(claude.readCalls(), [
      { args: ["plugin", "list", "--json"], cwd: fs.realpathSync(cwd) },
    ]);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(otherProject, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-diff-"));
  try {
    fs.writeFileSync(
      path.join(cwd, ".ccx.json"),
      JSON.stringify({ plugins: [] }),
    );
    const claude = installFakeClaude(home, {
      stdout: JSON.stringify([
        { id: "formatter@official", scope: "project", projectPath: "   " },
      ]),
    });

    const result = run(["project", "diff"], home, cwd, claude.env);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /invalid plugin listing.*projectPath/is);
    assert.doesNotMatch(result.stderr, /\n\s+at\s/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-project-"));
  try {
    const claude = installFakeClaude(home, { stdout: "[]" });
    const result = run(["project", "diff"], home, cwd, claude.env);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /No \.ccx\.json found/);
    assert.match(result.stderr, /ccx init/);
    assert.doesNotMatch(result.stderr, /\n\s+at\s/);
    assert.deepEqual(claude.readCalls(), []);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-project-"));
  try {
    fs.writeFileSync(path.join(cwd, ".ccx.json"), "{bad json");
    const claude = installFakeClaude(home, { stdout: "[]" });
    const result = run(["diff"], home, cwd, claude.env);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Invalid \.ccx\.json.*valid JSON/);
    assert.doesNotMatch(result.stderr, /\n\s+at\s/);
    assert.deepEqual(claude.readCalls(), []);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-project-"));
  try {
    const result = run(["install"], home, cwd);
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /No \.ccx\.json found/);
    assert.match(result.stdout + result.stderr, /ccx init/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-project-"));
  try {
    fs.writeFileSync(path.join(cwd, ".ccx.json"), JSON.stringify({ plugins: [] }));
    const claude = installFakeClaude(home, { stdout: "[]" });
    const result = run(["install"], home, cwd, claude.env);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Missing:\n  \(none\)/);
    assert.match(result.stderr, /Use ccx project up/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-project-"));
  try {
    fs.writeFileSync(path.join(cwd, ".ccx.json"), "{bad json");
    const result = run(["install"], home, cwd);
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /Invalid \.ccx\.json/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const result = run(["--help"], home);
  assert.equal(result.status, 0);
  assert.match(result.stdout + result.stderr, /______ ______ __   __/);
  assert.match(result.stdout + result.stderr, /ccx init/);
  assert.match(result.stdout, /Project Plugin Environment/);
  assert.match(result.stdout, /ccx project up/);
  assert.match(result.stdout, /2 Drift found by diff/);
  assert.match(result.stdout, /v0\.2\.0/);

  const version = run(["--version"], home);
  assert.equal(version.status, 0);
  assert.equal(version.stdout, "ccx v0.2.0\n");
});

// ── ccx save tests ─────────────────────────────────────────

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-diff-"));
  try {
    fs.writeFileSync(
      path.join(cwd, ".ccx.json"),
      JSON.stringify({ plugins: [] }),
    );
    const claude = installFakeClaude(home, {
      status: 23,
      stdout: "partial Claude output",
      stderr: "Claude listing unavailable",
    });

    const result = run(["diff"], home, cwd, claude.env);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /exited with status 23/);
    assert.match(result.stderr, /Claude listing unavailable/);
    assert.match(result.stderr, /partial Claude output/);
    assert.doesNotMatch(result.stderr, /\n\s+at\s/);
    assert.deepEqual(claude.readCalls(), [
      { args: ["plugin", "list", "--json"], cwd: fs.realpathSync(cwd) },
    ]);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const result = run(["save", "my-profile"], home);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /No \.ccx\.json found/);
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-save-"));
  try {
    fs.writeFileSync(path.join(cwd, ".ccx.json"), JSON.stringify({ plugins: ["plugin-a", "plugin-b"] }));
    const result = run(["save", "my-profile"], home, cwd);
    assert.equal(result.status, 0);
    assert.match(result.stdout + result.stderr, /Saved 2 plugin\(s\)/);
    assert.match(
      result.stderr,
      /Use ccx profile create --from-project my-profile/,
    );

    const profile = JSON.parse(fs.readFileSync(path.join(home, ".ccx", "profiles", "my-profile.json"), "utf-8"));
    assert.deepEqual(profile.plugins, ["plugin-a", "plugin-b"]);
    assert.equal(profile.name, "my-profile");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ── Canonical Profile and Plugin commands ────────────────

withHome((home) => {
  const created = run(["profile", "create", "work"], home);
  assert.equal(created.status, 0, created.stdout + created.stderr);
  assert.equal(created.stdout, 'Created profile "work" with 0 plugins.\n');
  assert.equal(created.stderr, "");

  const listed = run(["profile", "ls"], home);
  assert.equal(listed.status, 0, listed.stdout + listed.stderr);
  assert.equal(listed.stdout, "work  (0 plugins)\n");

  const inspected = run(["profile", "inspect", "work"], home);
  assert.equal(inspected.status, 0, inspected.stdout + inspected.stderr);
  assert.equal(inspected.stdout, "(empty)\n");
});

withHome((home) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ccx-profile-"));
  try {
    fs.writeFileSync(
      path.join(cwd, ".ccx.json"),
      JSON.stringify({
        plugins: ["zeta@official", "alpha@official", "zeta@official"],
      }),
    );

    const created = run(
      ["profile", "create", "--from-project", "work"],
      home,
      cwd,
    );
    assert.equal(created.status, 0, created.stdout + created.stderr);
    assert.deepEqual(
      JSON.parse(
        fs.readFileSync(
          path.join(home, ".ccx", "profiles", "work.json"),
          "utf8",
        ),
      ),
      { name: "work", plugins: ["zeta@official", "alpha@official"] },
    );

    assert.equal(
      run(
        ["profile", "update", "--add", "beta@official", "work"],
        home,
        cwd,
      ).status,
      0,
    );
    const invalidAdd = run(
      ["profile", "update", "--add", "bare-plugin", "work"],
      home,
      cwd,
    );
    assert.equal(invalidAdd.status, 1);
    assert.match(invalidAdd.stderr, /qualified Plugin Reference/);

    fs.writeFileSync(
      path.join(home, ".ccx", "profiles", "legacy.json"),
      JSON.stringify({
        name: "legacy",
        plugins: ["bare-plugin", "duplicate@official", "duplicate@official"],
      }),
    );
    const inspectedLegacy = run(
      ["profile", "inspect", "legacy"],
      home,
      cwd,
    );
    assert.equal(inspectedLegacy.status, 0);
    assert.match(inspectedLegacy.stdout, /bare-plugin/);
    assert.match(
      inspectedLegacy.stderr,
      /Legacy unqualified Plugin Reference.*plugin@marketplace/,
    );
    const legacyList = run(["list", "legacy"], home, cwd);
    assert.equal(legacyList.status, 0);
    assert.match(legacyList.stderr, /Legacy unqualified Plugin Reference/);
    const nestedLegacyList = run(["legacy", "list"], home, cwd);
    assert.equal(nestedLegacyList.status, 0);
    assert.match(
      nestedLegacyList.stderr,
      /Legacy unqualified Plugin Reference/,
    );
    const removedLegacy = run(
      ["profile", "update", "--remove", "bare-plugin", "legacy"],
      home,
      cwd,
    );
    assert.equal(
      removedLegacy.status,
      0,
      removedLegacy.stdout + removedLegacy.stderr,
    );
    assert.equal(
      JSON.parse(
        fs.readFileSync(
          path.join(home, ".ccx", "profiles", "legacy.json"),
          "utf8",
        ),
      ).plugins.filter((plugin) => plugin === "duplicate@official").length,
      1,
    );

    const removed = run(["profile", "rm", "work"], home, cwd);
    assert.equal(removed.status, 0, removed.stdout + removed.stderr);
    assert.equal(
      fs.existsSync(path.join(home, ".ccx", "profiles", "work.json")),
      false,
    );

    const unsafe = run(["profile", "create", "../outside"], home, cwd);
    assert.equal(unsafe.status, 1);
    assert.match(unsafe.stderr, /Invalid profile name/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

withHome((home) => {
  const marketplaceDir = path.join(
    home,
    ".claude",
    "plugins",
    "marketplaces",
    "team-source",
    ".claude-plugin",
  );
  fs.mkdirSync(marketplaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(marketplaceDir, "marketplace.json"),
    JSON.stringify({
      name: "team",
      plugins: [
        {
          name: "formatter",
          description: "Formats project files",
          category: "quality",
        },
        {
          name: "browser",
          description: "Controls a browser",
          category: "tools",
        },
      ],
    }),
  );

  const listed = run(["plugin", "ls"], home);
  assert.equal(listed.status, 0, listed.stdout + listed.stderr);
  assert.match(listed.stdout, /browser@team/);
  assert.match(listed.stdout, /formatter@team/);
  assert.doesNotMatch(listed.stdout, /installed/i);

  const searched = run(["plugin", "search", "quality"], home);
  assert.equal(searched.status, 0, searched.stdout + searched.stderr);
  assert.match(searched.stdout, /formatter@team/);
  assert.doesNotMatch(searched.stdout, /browser@team/);

  const legacySearch = run(["search", "formatter"], home);
  assert.equal(
    legacySearch.status,
    0,
    legacySearch.stdout + legacySearch.stderr,
  );
  assert.match(legacySearch.stdout, /formatter@team/);
  assert.doesNotMatch(legacySearch.stdout, /browser@team/);
  assert.match(legacySearch.stderr, /Use ccx plugin search formatter/);
});
