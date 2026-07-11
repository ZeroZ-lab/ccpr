# PRD: ccx 0.2 Project Plugin Environment

Status: ready-for-agent

## Problem Statement

Claude Code users need a reliable way to declare, inspect, and apply the plugins expected by a project. ccx 0.1 has grown two overlapping models—personal Profiles and a project `.ccx.json`—but still presents itself as a Profile manager. Its profile-first TTY mixes project actions into a selected Profile, command meanings change with argument count, installation state is inferred from directories in one path and ignored in another, and partial failures can still look successful. This makes the tool difficult for people, scripts, and agents to predict.

Users need the Project Manifest to be the clear source of desired project state, Installed State to be observed through Claude Code's supported CLI, and Profiles to remain reusable templates rather than competing configuration. They also need an incremental migration that does not immediately break existing ccx 0.1 commands or data.

## Solution

ccx 0.2 becomes a Project Plugin Environment manager. A version-controlled Project Manifest declares desired qualified Plugin References. `project diff` compares it with project-scoped Installed State, `project up` safely installs only missing plugins, and `project import` explicitly previews and captures Installed State. Undeclared local plugins are reported but never removed automatically.

The canonical CLI follows Docker's object-action grammar across `project`, `profile`, and `plugin`, with permanent short aliases for high-frequency project operations. The no-argument TTY becomes project-first and delegates to the same application operations as the CLI. Existing ccx 0.1 commands remain functional during 0.2 with a precise deprecation notice and are removed only where ambiguous in 0.3.

The implementation separates stable domain calculations and application operations from filesystem, Claude CLI, and presentation adapters. Behavior is verified primarily through the compiled CLI process using isolated homes/projects and a fake executable only at the external Claude boundary.

## User Stories

1. As a project maintainer, I want a Project Manifest to be the explicit desired plugin state, so that collaborators share the same expectations through version control.
2. As a new project maintainer, I want to initialize an empty Project Manifest explicitly, so that automation never depends on an interactive prompt.
3. As a returning user, I want to initialize a Project Manifest from a Profile, so that I can reuse a personal template without making that Profile authoritative for the project.
4. As a cautious maintainer, I want initialization to protect an existing Project Manifest, so that I cannot overwrite team configuration accidentally.
5. As an automation author, I want overwrite behavior to require an explicit flag outside a TTY, so that unattended scripts are deterministic.
6. As a project user, I want to see which declared plugins are missing, so that I know what ccx would install.
7. As a project user, I want to see which project-scoped plugins are undeclared, so that local Drift is visible without being destructive.
8. As a script author, I want a clean project diff to return zero, Drift to return two, and calculation errors to return one, so that I can distinguish state from failure.
9. As a project user, I want `project up` to install only missing plugins, so that repeated runs converge safely.
10. As a project user, I want undeclared plugins left installed, so that Apply never destroys intentional local work.
11. As a project user, I want Apply to continue across independent plugin failures, so that one bad plugin does not hide the outcome of all others.
12. As a script author, I want partial Apply failures to return non-zero, so that CI and agents cannot mistake them for success.
13. As a project user, I want every failed plugin and available Claude diagnostic in the final report, so that remediation is actionable.
14. As a project user, I want an already-converged Apply to perform no install calls, so that repeated execution is cheap and predictable.
15. As a maintainer, I want Installed State read from `claude plugin list --json`, so that ccx relies on Claude Code's supported interface rather than cache layout.
16. As a maintainer, I want project Installed State filtered by scope and normalized project path, so that plugins belonging to other projects or user scope do not satisfy this Project Manifest.
17. As a project user, I want malformed or unsupported Claude JSON reported as an external-boundary error, so that ccx never acts on guessed state.
18. As a project user, I want Import to preview additions and removals before writing, so that capturing local state is deliberate.
19. As an automation author, I want non-interactive Import to require `--yes`, so that a write cannot occur through an implicit confirmation.
20. As a project user, I want Import to capture an empty Installed State when explicitly confirmed, so that clearing a manifest is possible and intentional.
21. As a user, I want Profiles described and managed as reusable templates, so that their relationship to projects is clear.
22. As a user, I want to create an empty Profile or copy one from a Project Manifest, so that I can build templates from either direction without reading plugin caches.
23. As a user, I want to list and inspect Profiles with stable commands, so that command meaning does not depend on argument count.
24. As a user, I want to add or remove a qualified Plugin Reference from a Profile, so that templates remain editable without ambiguous identities.
25. As a user, I want Profile names validated before paths are derived, so that template operations cannot escape the Profile directory.
26. As a plugin explorer, I want marketplace listings to show qualified Plugin References, descriptions, categories, and sources, so that I can choose an unambiguous identity.
27. As a plugin explorer, I want catalog search to match identity, description, and category, so that discovery remains useful without implying installation.
28. As a command-line user, I want canonical commands grouped under `project`, `profile`, and `plugin`, so that the interface scales predictably.
29. As a frequent user, I want permanent `init`, `up`, and `diff` aliases, so that the main project journey stays concise.
30. As a manual user, I want the no-argument TTY to start from the current project's state, so that the product's primary mental model matches my task.
31. As a manual user, I want the TTY and command mode to call identical operations, so that choosing an interface does not change behavior.
32. As a non-interactive caller, I want complete commands never to prompt or animate, so that logs and pipes remain stable.
33. As a non-interactive caller, I want normal results on stdout and warnings/errors on stderr, so that output can be composed safely.
34. As an existing ccx user, I want every 0.1 command to continue working during 0.2, so that I can migrate scripts deliberately.
35. As an existing ccx user, I want each deprecated invocation to name its canonical replacement, so that migration requires no documentation search.
36. As a maintainer, I want ambiguous legacy routing isolated in presentation, so that its 0.3 removal cannot disturb domain or application behavior.
37. As an existing user with bare plugin names, I want legacy data to remain readable with migration guidance, so that ccx 0.2 does not destroy or silently reinterpret it.
38. As a new user, I want new canonical writes to require `plugin@marketplace`, so that cross-marketplace identities cannot collide silently.
39. As a maintainer, I want deterministic ordering and duplicate normalization, so that Project Manifest and Profile diffs remain reviewable.
40. As a maintainer, I want ccx to identify itself as version 0.2.0 after the migration lands, so that deprecation and support expectations are explicit.

## Implementation Decisions

- The canonical domain language is Project Plugin Environment, Project Manifest, Profile, Installed State, Drift, Apply, Import, and Plugin Reference as defined in the project glossary.
- The Project Manifest remains a minimal JSON object containing an ordered plugin-reference array. Profiles retain their current name plus plugin-reference array shape for backward compatibility.
- Project Manifest lookup is limited to the current working directory; parent discovery is not added.
- New canonical writes require marketplace-qualified Plugin References. Legacy bare values remain readable and receive migration guidance; ccx does not invent a marketplace qualification.
- Qualified references are compared as identities. Duplicate writes retain the first declaration and preserve stable order.
- Installed State is obtained only from the Claude Code JSON listing. The adapter validates the top-level value and every field it consumes.
- Project Installed State includes only project-scope entries whose normalized project path equals the current project root. User, local, managed, other-project, marketplace, and cache entries are excluded.
- Apply computes Drift and installs only missing references at project scope. It never invokes uninstall. It returns a complete report containing initial Drift, successful installs, and per-plugin failures.
- Import is a two-step operation: prepare an immutable preview, then commit exactly that preview after presentation obtains explicit approval.
- Marketplace metadata remains a discovery source only. Catalog entries expose a qualified reference assembled from marketplace name and plugin name.
- Canonical commands are exactly those in the resolved public command contract. High-frequency project aliases remain permanent; other 0.1 forms are compatibility translations with warnings.
- Unknown canonical commands fail as usage errors and are never reinterpreted as Profile names.
- Exit statuses are zero for success, one for usage/runtime/partial failure, and two only when a successful project diff detects Drift.
- Expected domain, usage, storage, Claude CLI, and partial Apply failures use typed results across application boundaries. Presentation alone renders them and chooses process status.
- The implementation has five cohesive seams: pure domain state/Drift, application operations and ports, filesystem stores, Claude CLI adapter, and shared CLI/TTY presentation. A thin composition root supplies process globals and concrete adapters.
- The pure domain seam imports no filesystem, process, prompt, or color APIs. Application logic depends only on domain values and ports.
- Filesystem stores receive home and project roots as inputs, validate external JSON, and never log, prompt, compute Drift, or invoke Claude.
- The Claude adapter is the only child-process boundary. It preserves child status/stdout/stderr on failure and never scans plugin directories for Installed State.
- TTY and CLI controllers call the same application operations. The TTY only gathers choices/confirmation and renders results.
- Human animation and color are used only when appropriate for a TTY. Non-TTY output is stable plain text.
- The migration is expand-contract: add canonical routes and shared operations alongside legacy routes in 0.2, translate legacy invocations with warnings, then remove only ambiguous forms in 0.3.
- The package version becomes 0.2.0, but publishing and release creation are separate work.

## Testing Decisions

- The pre-agreed primary seam is the compiled `ccx` process because it is the highest public boundary and matches the repository's existing black-box tests.
- Each test receives a temporary home and project working directory, disables color, and invokes the compiled executable as a user or script would.
- The only test double is a temporary executable named `claude` placed first on `PATH`. It accepts real arguments and working directory, returns configured JSON/status/stdout/stderr, and records calls for public-boundary assertions.
- Tests assert process status, stdout/stderr, Project Manifest/Profile files, and the fake Claude call log. They do not import or mock stores, application operations, presenters, or the process runner.
- Tracer tests cover scope/path filtering, clean and drifting diffs, add-only Apply, no-op Apply, partial failures, malformed Claude output, Import preview and confirmation, qualified writes, Profile lifecycle, catalog discovery, canonical routing, non-TTY guarantees, and each legacy mapping class.
- Red-green cycles proceed one observable behavior at a time. The full suite and typecheck run after every completed vertical ticket and once more at the end.
- Direct pure-domain tests are added only if a critical edge cannot be observed through process status/output, files, or fake-Claude calls; the reason must be recorded with the test.

## Out of Scope

- Automatically uninstalling undeclared plugins or performing exact destructive reconciliation.
- Plugin version locks, dependency solving, or selecting versions in the Project Manifest.
- Parent-directory Project Manifest discovery or monorepo inheritance.
- Managing marketplace registration, updates, restrictions, or authentication.
- Replacing Claude Code's project scope, settings model, or plugin dependency behavior.
- Shell completion, remote manifests, cloud Profile sync, telemetry, or analytics.
- New runtime dependencies, dependency upgrades, npm publishing, GitHub Releases, or deployment.
- Removing ambiguous compatibility routes before ccx 0.3.
- Writing planning issues to the GitHub remote while the remote repository identity remains unconfirmed.

## Further Notes

- The existing CLI process seam was selected without another confirmation pause because the user explicitly delegated remaining decisions and requested uninterrupted delivery.
- The previous assumption that Claude plugins have no versions is false; current Claude Code exposes versions. Version locking remains excluded deliberately rather than because versions do not exist.
- External behavior was checked against local Claude Code 2.1.205 and current Anthropic plugin documentation. The JSON output is validated defensively because Anthropic documents the flag but does not publish a versioned schema or granular stable exit-code taxonomy.
- The detailed command matrix, Claude runtime research, implementation seams, glossary, and CLI grammar ADR are linked from the Wayfinder map for maintainers who need decision context.
