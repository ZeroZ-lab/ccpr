# ccx

Agent Profile Manager for Claude Code.

`ccx` lets you save named Claude Code plugin profiles and install a whole profile into the current project with one command. It is designed as a command-first CLI, with a lightweight interactive wizard for manual use.

## Installation

```bash
npm install -g @guanmu/ccprofile
```

Or with Bun:

```bash
bun add -g @guanmu/ccprofile@latest
```

Verify the installed version:

```bash
ccx --version
```

## Quick Start

```bash
ccx create dev
ccx add dev cc-design
ccx add dev browser
ccx list dev
ccx install dev
```

`ccx install dev` runs `claude plugin install <plugin> --scope project` for every plugin in the `dev` profile.

## Commands

```bash
ccx                            # Interactive wizard, TTY only
ccx ui                         # Interactive wizard, TTY only

ccx install <profile>          # Install all plugins from a profile
ccx create <name>              # Create a profile
ccx delete <name>              # Delete a profile
ccx profiles                   # List all profiles

ccx add <profile> <plugin>     # Add a plugin to a profile
ccx remove <profile> <plugin>  # Remove a plugin from a profile
ccx list <profile>             # List plugins in a profile
ccx search <keyword>           # Search plugins in installed marketplaces

ccx --version                  # Show version
ccx --help                     # Show help
```

Legacy aliases are still supported:

```bash
ccx <profile>                  # Same as ccx install <profile>
ccx <profile> add [plugin]
ccx <profile> remove [plugin]
ccx <profile> list
ccx add <name>                 # Same as ccx create <name>
ccx remove <name>              # Same as ccx delete <name>
ccx list                       # Same as ccx profiles
```

## Interactive Wizard

Run:

```bash
ccx
```

The wizard is grouped into lightweight pages:

- `Install` - install plugins from a profile
- `Profiles` - create, list, and delete profiles
- `Plugins` - add, remove, and list profile plugins
- `Marketplace` - search installed plugin marketplaces
- `Help` - print command usage

The wizard only runs in a real TTY. In scripts, CI, or agent execution environments, use the command form instead.

## Profiles

Profiles are stored as JSON files under:

```text
~/.ccx/profiles/
```

Example profile:

```json
{
  "name": "dev",
  "plugins": [
    "cc-design",
    "browser"
  ]
}
```

Profile names may contain letters, numbers, dots, underscores, and hyphens.

## Marketplace Search

`ccx search <keyword>` reads Claude plugin marketplaces from:

```text
~/.claude/plugins/marketplaces/
```

Search matches plugin name, description, or category. Invalid marketplace files are skipped with a warning.

## Requirements

- Node.js 20.12 or newer
- Claude Code CLI available as `claude`
- Claude plugin marketplaces installed if you want marketplace search

## Development

```bash
pnpm install
pnpm run build
pnpm test
```

Run from source:

```bash
pnpm run dev
```

## Release

This package is published to npm from GitHub Releases.

1. Bump `package.json`.
2. Commit and push to `master`.
3. Create a GitHub release tag like `v0.1.10`.
4. The `Publish to npm` workflow builds and publishes the package.
