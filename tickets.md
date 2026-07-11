# Tickets: ccx 0.2 Project Plugin Environment

These tickets implement the [ccx 0.2 PRD](.scratch/ccx-0.2/PRD.md) as a Docker-style, project-centered, safely convergent CLI and TTY.

Work the **frontier**: any ticket whose blockers are all done. Each ticket is a vertical, externally verifiable slice.

## Inspect Project Drift through the public CLI

**What to build:** Establish the shared domain/application/adaptor path by making canonical and short-form Project Drift inspection work end to end through the compiled CLI and Claude Code's supported JSON listing.

**Blocked by:** None — can start immediately.

- [x] `ccx project diff` and `ccx diff` read the current Project Manifest and report deterministic Missing and Undeclared groups.
- [x] Installed State includes only project-scope entries for the normalized current project root.
- [x] Clean, drifting, and failed inspection return exit statuses 0, 2, and 1 respectively.
- [x] Missing/invalid manifests and malformed/failed Claude listings produce actionable stderr without stack traces.
- [x] Black-box tests use isolated home/project roots and a fake `claude` executable at the external process boundary.
- [x] Domain, application, storage, Claude, presentation, and composition responsibilities no longer depend on one monolithic entry module for this path.

## Safely bring the Project Plugin Environment up

**What to build:** Make `ccx project up` converge a project by installing only missing declared plugins while returning an honest complete report.

**Blocked by:** Inspect Project Drift through the public CLI.

- [x] `ccx project up` and `ccx up` install only Missing Plugin References with project scope and the current project working directory.
- [x] Already installed and Undeclared plugins cause no install or uninstall call.
- [x] Independent installs continue after a failure and the report separates installed and failed references.
- [x] Any partial failure exits 1 and never prints an unconditional success message; complete/no-op Apply exits 0.
- [x] Canonical Apply rejects ambiguous new state safely while bounded legacy behavior remains possible for the compatibility ticket.
- [x] Public-process tests cover no-op, successful, partial-failure, listing-failure, and add-only behavior.

## Initialize and import Project Manifests safely

**What to build:** Complete the Project Manifest lifecycle with explicit initialization sources and a preview-confirmed Installed State import.

**Blocked by:** Inspect Project Drift through the public CLI.

- [ ] Project initialization supports explicit empty state and creation from a Profile.
- [ ] Existing Project Manifests require TTY confirmation or an explicit force option before overwrite.
- [ ] Non-interactive initialization without an explicit source exits 1 without writing.
- [ ] Project import prints the exact additions/removals before any write and commits exactly the previewed Installed State.
- [ ] Non-interactive import requires explicit approval and supports intentional empty-state import.
- [ ] New canonical writes are deterministically ordered, deduplicated, and require qualified Plugin References.
- [ ] Black-box tests cover create, overwrite protection, Profile source, preview-only, confirmed import, and malformed external state.

## Manage Profiles and discover qualified Plugins

**What to build:** Expose Profiles as reusable templates and marketplace entries as discovery metadata through unambiguous Docker-style object commands.

**Blocked by:** Inspect Project Drift through the public CLI.

- [ ] Profile create, list, inspect, update-add, update-remove, and remove work through their canonical object commands.
- [ ] Profile creation can copy the current Project Manifest without reading Installed State or plugin caches.
- [ ] Profile names remain path-safe and missing/invalid data returns non-zero diagnostics.
- [ ] Plugin list/search show marketplace-qualified identities and match identity, description, and category.
- [ ] Catalog discovery does not claim that a plugin is installed.
- [ ] New Profile additions require qualified Plugin References while legacy Profile data remains readable and removable.
- [ ] Public-process tests cover the full Profile lifecycle, catalog qualification/search, duplicates, and invalid inputs.

## Unify the project-first TTY and ccx 0.1 migration bridge

**What to build:** Finish ccx 0.2 as one coherent product by routing the project-first TTY and every supported 0.1 invocation through the same application behavior, then document the migration.

**Blocked by:** Safely bring the Project Plugin Environment up; Initialize and import Project Manifests safely; Manage Profiles and discover qualified Plugins.

- [ ] No-argument TTY starts from the current project, shows Drift when a Project Manifest exists, and offers initialization when it does not.
- [ ] TTY Project, Profile, and Plugin actions call the same operations and return the same result semantics as command mode.
- [ ] Complete non-TTY invocations never prompt, colorize, or animate; results use stdout and warnings/errors use stderr.
- [ ] Every ccx 0.1 command and alias listed in the public command contract still works during 0.2 and prints one canonical replacement notice when deprecated.
- [ ] Unknown canonical commands are not interpreted as Profile names; ambiguous legacy routing remains isolated for removal in 0.3.
- [ ] Help and README describe the Project Plugin Environment, Docker-style commands, TTY journey, migration window, exit statuses, and qualified Plugin References.
- [ ] The package identifies as 0.2.0 without publishing or creating a release.
- [ ] Full build, black-box test suite, diff checks, and two-axis code review pass.
