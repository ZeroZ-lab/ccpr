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

function installFakeClaude(home, list) {
  const binDir = path.join(home, "bin");
  const configPath = path.join(home, "fake-claude.json");
  const logPath = path.join(home, "fake-claude-calls.jsonl");
  const executable = path.join(binDir, "claude");

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ list }));
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
if (args.join(" ") !== "plugin list --json") {
  process.stderr.write("Unexpected fake Claude invocation: " + args.join(" "));
  process.exit(64);
}
process.stdout.write(config.list.stdout || "");
process.stderr.write(config.list.stderr || "");
process.exit(config.list.status ?? 0);
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
  assert.match(result.stdout + result.stderr, /Skipping invalid marketplace/);
});

withHome((home) => {
  assert.equal(run(["create", "dev"], home).status, 0);

  const profiles = run(["profiles"], home);
  assert.equal(profiles.status, 0);
  assert.match(profiles.stdout + profiles.stderr, /dev\s+\(0 plugins\)/);

  assert.equal(run(["add", "dev", "plugin-a"], home).status, 0);

  const plugins = run(["list", "dev"], home);
  assert.equal(plugins.status, 0);
  assert.match(plugins.stdout + plugins.stderr, /plugin-a/);

  const legacyPlugins = run(["dev", "list"], home);
  assert.equal(legacyPlugins.status, 0);
  assert.match(legacyPlugins.stdout + legacyPlugins.stderr, /plugin-a/);
});

// ── Project config tests (.ccx.json) ─────────────────────

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
    const result = run(["install"], home, cwd);
    assert.equal(result.status, 0);
    assert.match(result.stdout + result.stderr, /No plugins in \.ccx\.json/);
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
  assert.match(result.stdout + result.stderr, /Install plugins from \.ccx\.json/);
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

    const profile = JSON.parse(fs.readFileSync(path.join(home, ".ccx", "profiles", "my-profile.json"), "utf-8"));
    assert.deepEqual(profile.plugins, ["plugin-a", "plugin-b"]);
    assert.equal(profile.name, "my-profile");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
