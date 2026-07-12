# ccx

```text
   ______ ______ __   __
  / ____// ____/ \ \ / /
 | |    | |      \ V /
 | |___ | |___   / . \
  \____/ \____/ /_/ \_\
```

Project Plugin Environment Manager for Claude Code.

ccx keeps the plugins expected by a project in a version-controlled `.ccx.json`, shows Drift from the project-scoped plugins Claude Code actually reports, and installs only what is missing. Personal Profiles remain reusable templates for creating Project Manifests.

## Install

```bash
bun add -g @guanmu/ccprofile@latest
ccx --version
```

Node.js 20.12 or newer and the `claude` CLI are required.

## Project workflow

Create a Project Manifest, inspect Drift, and bring the environment up:

```bash
ccx init --empty
ccx diff
ccx up
```

Project commands also have canonical Docker-style object forms:

```bash
ccx project init --empty
ccx project init --from-profile work
ccx project diff
ccx project up
ccx project import
ccx project import --yes
```

- `init` writes `.ccx.json`; an existing file requires TTY confirmation or `--force`.
- `diff` shows `Missing` and `Undeclared`. It never changes state.
- `up` installs only `Missing` plugins with Claude Code project scope. It never uninstalls `Undeclared` plugins.
- `import` previews additions/removals before capturing Installed State. Non-interactive use requires `--yes`.

`diff` exits `0` when clean, `2` when Drift exists, and `1` when inspection fails. Other commands exit `0` on success and `1` for usage, runtime, or partial Apply failure.

## Project Manifest

`.ccx.json` contains an ordered set of marketplace-qualified Plugin References:

```json
{
  "plugins": [
    "frontend-design@claude-plugins-official",
    "browser@team-tools"
  ]
}
```

New canonical writes require `plugin@marketplace`. Legacy bare names remain readable for migration but are not guessed or silently qualified.

Installed State comes from `claude plugin list --json`, filtered to project scope and the normalized current project path. ccx does not infer installation from `.claude/plugins/` or cache directories.

## Profiles

Profiles are user-scoped templates stored under `~/.ccx/profiles/`:

```bash
ccx profile create work
ccx profile create --from-project work
ccx profile ls
ccx profile inspect work
ccx profile update --add browser@team-tools work
ccx profile update --remove browser@team-tools work
ccx profile rm work
```

Use `ccx project init --from-profile work` to create project desired state from a Profile. The Profile is not authoritative after initialization.

## Plugin discovery

```bash
ccx plugin ls
ccx plugin search frontend
```

Discovery reads installed marketplace catalogs and prints qualified references. Catalog presence does not imply a plugin is installed.

## Interactive mode

Run `ccx` or `ccx ui` in a TTY. The first screen is the current project:

- without `.ccx.json`: initialize a manifest, manage Profiles, or browse the catalog;
- with `.ccx.json`: view Drift, run Up, Import Installed State, manage Profiles, or browse the catalog.

The TTY calls the same application operations as command mode. In scripts, CI, and agent environments, complete commands never prompt or animate; normal results go to stdout and warnings/errors go to stderr.

## Migrating from ccx 0.1

ccx 0.2 keeps 0.1 commands working and prints the canonical replacement to stderr. Ambiguous forms are scheduled for removal in ccx 0.3.

| ccx 0.1 | ccx 0.2 canonical command |
| --- | --- |
| `ccx install` | `ccx project up` |
| `ccx sync` | `ccx project import --yes` |
| `ccx save NAME` | `ccx profile create --from-project NAME` |
| `ccx create NAME` | `ccx profile create NAME` |
| `ccx delete NAME` | `ccx profile rm NAME` |
| `ccx profiles` / `ccx list` | `ccx profile ls` |
| `ccx add PROFILE PLUGIN` | `ccx profile update --add PLUGIN PROFILE` |
| `ccx remove PROFILE PLUGIN` | `ccx profile update --remove PLUGIN PROFILE` |
| `ccx list PROFILE` | `ccx profile inspect PROFILE` |
| `ccx search KEYWORD` | `ccx plugin search KEYWORD` |

Direct Profile installation remains available during 0.2 for compatibility but does not create a Project Manifest. Prefer initializing from the Profile and then running `ccx up`.

## Development

```bash
pnpm install
pnpm run build
pnpm test
```

The npm package is published from GitHub Releases. Publishing and release creation are intentionally separate from implementation changes.
