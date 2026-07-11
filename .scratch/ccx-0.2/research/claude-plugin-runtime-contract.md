# Claude Code plugin runtime contract

Checked on 2026-07-11 against local Claude Code 2.1.205 and current Anthropic documentation.

## Safe contract

- A plugin reference is `plugin-name@marketplace-name`; unqualified names are accepted by Claude but are ambiguous and should not be written by new ccx commands.
- `claude plugin list --json` is the authoritative installed-state interface. On 2.1.205 each observed entry includes `id`, `scope`, `enabled`, and, for project/local entries, `projectPath`; ccx must validate rather than assume this JSON shape.
- Project Installed State is the set of entries whose `scope` is `project` and whose normalized `projectPath` equals the current project directory. User/local entries do not satisfy a Project Manifest that ccx applies with project scope.
- `claude plugin install <reference> --scope project` is the supported Apply boundary. Any non-zero child status is a plugin failure; ccx should preserve per-plugin diagnostics and return non-zero if any install fails.
- `claude plugin uninstall`, `update`, `enable`, `disable`, and `validate` exist, but automatic removal remains outside ccx 0.2.
- Marketplace catalogs and installed plugin caches are not installation records. In particular, plugin content is copied into a versioned global cache under `~/.claude/plugins/cache`; cache entries can outlive active installation state.

## Guardrails

- Anthropic documents `--json`, but not a versioned JSON schema or stable error-code taxonomy. Treat malformed output and all non-zero statuses as boundary errors with actionable stderr.
- Do not infer Installed State by scanning `.claude/plugins/` or the global cache.
- Plugin versions exist, despite an older ccx spec assuming otherwise. ccx 0.2 still stores references without versions; version locking remains explicitly out of scope.

## Sources

- [Claude Code Plugins reference](https://code.claude.com/docs/en/plugins-reference)
- [Discover and install plugins](https://code.claude.com/docs/en/discover-plugins)
- [Create and distribute a plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces)
- Local read-only evidence: `claude --version`, `claude plugin list --help`, `claude plugin install --help`, and `claude plugin list --json`.
