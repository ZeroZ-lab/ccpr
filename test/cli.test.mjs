import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bin = path.join(repoRoot, "dist", "index.js");

function run(args, home, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: cwd || repoRoot,
    env: {
      ...process.env,
      HOME: home,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
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
