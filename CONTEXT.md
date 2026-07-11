# CCX Project Plugin Environment

CCX defines and applies the Claude Code plugins expected by a project, while allowing users to reuse personal plugin templates across projects.

## Language

**Project Plugin Environment**:
The set of Claude Code plugins a project declares as its desired working environment.
_Avoid_: Project profile, installed plugins

**Project Manifest**:
The versionable `.ccx.json` file that declares a Project Plugin Environment.
_Avoid_: Project profile, lockfile

**Profile**:
A user-scoped, named plugin template that can be reused to prepare Project Manifests; it is not authoritative project state.
_Avoid_: Environment, manifest

**Installed State**:
The locally observed set of project plugins; it may differ from the Project Manifest and does not overwrite it implicitly.
_Avoid_: Configuration, desired state

**Drift**:
The difference between the Project Manifest and Installed State, including missing and undeclared local plugins.
_Avoid_: Sync state, configuration error

**Apply**:
A safe convergence operation that installs plugins missing from Installed State without removing undeclared local plugins.
_Avoid_: Exact sync, reconcile

**Import**:
An explicit, previewed operation that updates the Project Manifest from Installed State.
_Avoid_: Sync, automatic discovery

**Plugin Reference**:
A marketplace-qualified Claude Code plugin identity in `plugin-name@marketplace-name` form.
_Avoid_: Bare plugin name, plugin path
