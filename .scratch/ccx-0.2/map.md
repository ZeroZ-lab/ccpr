## Destination

Deliver a verified ccx 0.2 implementation, backed by a product and technical spec plus vertical implementation tickets, that makes the Project Plugin Environment the product center and exposes a Docker-style CLI.

## Notes

- Work may continue through specification and implementation in this map because the user explicitly requested end-to-end delivery without further confirmation pauses.
- Use `wayfinder`, `to-spec`, `to-tickets`, `implement`, `tdd`, and `code-review`.
- The Project Manifest is desired state; Apply is add-only; Import is explicit and previewed.
- Canonical commands use `ccx <object> <action>` with high-frequency project aliases.
- The TTY is project-first and delegates to the same application operations as the CLI.
- ccx 0.2 keeps legacy commands with deprecation warnings; ambiguous legacy routing is removed in ccx 0.3.
- The local Markdown tracker is authoritative for this effort.

## Decisions so far

- [Define the Claude Code plugin runtime contract](issues/01-claude-plugin-runtime-contract.md) — use qualified references, query `claude plugin list --json` for project-scoped Installed State, and guard unversioned output/error details.
- [Define the implementation and public test seams](issues/03-implementation-seams.md) — separate pure domain/application contracts from filesystem and Claude adapters, share operations across CLI/TTY, and verify through the compiled process with an executable fake `claude` on `PATH`.
- [Define the ccx 0.2 public command contract](issues/02-public-command-contract.md) — use Docker-style project/profile/plugin commands, project-first TTY behavior, deterministic 0/1/2 exits, and a bounded ccx 0.1 deprecation bridge.

## Not yet specified


## Out of scope

- Automatically removing undeclared local plugins during Apply.
- Plugin version locking or dependency resolution.
- Parent-directory Project Manifest discovery.
- Dependency upgrades, publishing, or deployment.
- Writing issues to the GitHub remote while its `ccpr` name differs from this `ccx` project.
