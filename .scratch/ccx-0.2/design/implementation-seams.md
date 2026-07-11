# ccx 0.2 implementation seams

## Decision

Use five cohesive implementation modules plus a composition root. The boundary is intentionally smaller than a layered directory tree: split only where ccx crosses an I/O boundary or where CLI and TTY must share behavior.

1. `domain.ts` — Project Manifest, Installed State, plugin references, and pure Drift calculation.
2. `application.ts` — use-case operations and the ports they require.
3. `stores.ts` — filesystem implementations for Project Manifests, Profiles, and the read-only marketplace catalog.
4. `claude-cli.ts` — the only adapter allowed to execute `claude` or interpret its plugin JSON.
5. `presentation.ts` — canonical/legacy CLI routing, output and exit mapping, and the TTY flow.
6. `index.ts` — a thin composition root that supplies `cwd`, `HOME`, process execution, and the concrete adapters, then invokes presentation.

These are module boundaries, not a requirement to introduce one class per operation. Split a module further only after its responsibilities can no longer be understood together.

## Domain state and Drift

`domain.ts` has no Node, filesystem, process, prompt, color, or child-process imports. It owns only stable product language and pure transformations:

```ts
type PluginReference = string & { readonly __pluginReference: unique symbol };

interface ProjectManifest {
  readonly plugins: readonly PluginReference[];
}

interface InstalledState {
  readonly projectRoot: string;
  readonly plugins: readonly PluginReference[];
}

interface Drift {
  readonly missing: readonly PluginReference[];
  readonly undeclared: readonly PluginReference[];
}

function parsePluginReference(input: string): Result<PluginReference, DomainError>;
function diff(manifest: ProjectManifest, installed: InstalledState): Drift;
```

New ccx 0.2 writes accept only marketplace-qualified `plugin-name@marketplace-name` references. Reading and migration behavior for legacy bare values belongs to the command contract; the domain parser must make that choice explicit rather than silently guessing a marketplace.

`diff` compares references as identities. `missing` is declared but absent from project Installed State; `undeclared` is project-installed but absent from the Project Manifest. Apply consumes only `missing`. It never turns `undeclared` into uninstall work. Ordering and duplicate policy must be deterministic and documented when the manifest schema is finalized.

The adapter, not the domain, decides which Claude JSON entries belong to the project. This prevents user/local plugins or cache contents from being mistaken for Installed State.

## Typed results and errors

Expected failures cross every seam as a discriminated `Result`; only programmer defects may escape as exceptions. Adapters catch filesystem, JSON, and child-process exceptions and translate them before returning.

```ts
type Result<T, E extends CcxError = CcxError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

type CcxError =
  | DomainError
  | UsageError
  | StoreError
  | ClaudeCliError
  | ApplyError;

type DomainError = {
  readonly kind: "domain";
  readonly code: "invalid_plugin_reference" | "invalid_manifest";
  readonly message: string;
};

type UsageError = {
  readonly kind: "usage";
  readonly code: "unknown_command" | "missing_argument" | "invalid_argument" | "tty_required";
  readonly message: string;
  readonly usage?: string;
};

type StoreError = {
  readonly kind: "store";
  readonly code: "not_found" | "invalid_json" | "invalid_data" | "read_failed" | "write_failed";
  readonly subject: "manifest" | "profile" | "catalog";
  readonly path: string;
  readonly message: string;
};

type ClaudeCliError = {
  readonly kind: "claude_cli";
  readonly code: "spawn_failed" | "command_failed" | "invalid_json" | "invalid_shape";
  readonly operation: "list" | "install";
  readonly message: string;
  readonly status?: number;
  readonly stdout?: string;
  readonly stderr?: string;
};

interface ApplyReport {
  readonly drift: Drift;
  readonly installed: readonly PluginReference[];
  readonly failed: readonly {
    reference: PluginReference;
    error: ClaudeCliError;
  }[];
}

type ApplyError = {
  readonly kind: "apply";
  readonly code: "partial_failure" | "installed_state_unavailable";
  readonly message: string;
  readonly report?: ApplyReport;
  readonly cause?: ClaudeCliError | StoreError;
};
```

An Apply with any failed install returns `partial_failure` and carries the full report, so presentation can show successes and per-plugin diagnostics while still exiting non-zero. Do not reduce boundary errors to booleans or reconstruct them from rendered text. Presentation alone maps typed failures to user-facing text and the exit-code policy settled by the CLI contract.

## Application ports and operations

`application.ts` imports the domain and declares the minimal ports. It does not import concrete stores, `child_process`, prompts, colors, `console`, or `process`.

```ts
interface ManifestStore {
  read(projectRoot: string): Result<ProjectManifest, StoreError>;
  write(projectRoot: string, manifest: ProjectManifest): Result<void, StoreError>;
}

interface ProfileStore {
  list(): Result<readonly string[], StoreError>;
  read(name: string): Result<ProjectManifest, StoreError>;
  write(name: string, manifest: ProjectManifest): Result<void, StoreError>;
  remove(name: string): Result<void, StoreError>;
}

interface MarketplaceCatalogStore {
  list(): Result<readonly CatalogPlugin[], StoreError>;
}

interface ClaudePluginClient {
  listProject(projectRoot: string): Result<InstalledState, ClaudeCliError>;
  installProject(
    projectRoot: string,
    reference: PluginReference,
  ): Result<void, ClaudeCliError>;
}
```

Application operations are functions or one small service constructed with these ports:

- inspect a Project Plugin Environment by reading its Project Manifest, observing Installed State, and returning Drift;
- Apply by installing only `missing` references and returning an `ApplyReport` without removing `undeclared` references;
- prepare an Import preview from Installed State, then commit exactly the previewed Project Manifest only after presentation obtains explicit approval;
- create or update a Project Manifest from explicit input or a Profile;
- perform Profile lifecycle operations;
- browse the marketplace catalog as discovery metadata only.

The Import preview and commit are separate application calls. TTY confirmation is not passed into storage, and a non-interactive command cannot bypass preview merely because it uses a different presenter. The exact command names, arguments, output, confirmation flag, and exit-code mapping remain for the CLI contract to settle.

## Filesystem stores

`stores.ts` implements the three storage ports with roots supplied by the composition root:

- `ManifestStore` reads and writes only `<cwd>/.ccx.json`; it does not discover parent manifests.
- `ProfileStore` uses `<HOME>/.ccx/profiles` and validates names before deriving paths.
- `MarketplaceCatalogStore` reads marketplace metadata beneath `<HOME>/.claude/plugins/marketplaces` for browsing only.

Stores validate external JSON into domain values and return path-bearing typed errors. They do not log, prompt, set exit codes, calculate Drift, invoke Claude, or treat marketplace/cache directories as installation records. `HOME` and `cwd` are invocation inputs rather than constants captured when the module loads, which keeps multiple roots testable and avoids hidden process-global state.

## Claude CLI adapter

`claude-cli.ts` is the single child-process boundary:

- run `claude plugin list --json` with `cwd` set to the requested project root;
- validate the top-level JSON and every field used by ccx rather than casting it;
- retain only entries with `scope === "project"` and normalized `projectPath === normalized projectRoot`;
- obtain identity from Claude's qualified `id` and reject malformed entries needed for the result;
- run `claude plugin install <reference> --scope project` with the same project root as `cwd`;
- preserve status, stdout, and stderr on non-zero or malformed responses;
- never scan `.claude/plugins`, marketplace directories, or the plugin cache for Installed State.

The adapter may receive a narrow process runner from the composition root for implementation convenience, but tests should not mock that runner. The supported substitute is an executable named `claude` on `PATH`, exercising the same OS process boundary as production.

## CLI and TTY presentation

`presentation.ts` contains two controllers over the same application object:

- the CLI controller parses canonical Docker-style object-action grammar and bounded legacy aliases, renders results/errors, emits deprecation warnings, and sets the final exit code;
- the TTY controller gathers selections and explicit confirmations, then calls the identical application operations and renders the same typed results.

Neither controller reads/writes JSON, computes Drift, calls `claude`, or installs plugins directly. Legacy routing is presentation-only: it translates an old invocation into a canonical operation request, so deleting ambiguous legacy routes in ccx 0.3 cannot disturb domain or application behavior.

## Dependency direction

```text
domain <- application <- presentation
   ^           ^
   |           |
stores --------+----- claude-cli
        \      |      /
          composition root (index.ts)
```

- Domain imports nothing from the other seams.
- Application imports domain and owns the port interfaces.
- Stores and the Claude adapter import domain/application types only to implement ports.
- Presentation imports application/domain result types, never concrete adapters.
- The composition root is the only module that knows all concrete pieces and process globals.

## Highest public testing seam

The default test seam is one black-box invocation of the compiled CLI: spawn `node dist/index.js ...` with an isolated temporary `HOME`, an isolated temporary project `cwd`, colors disabled, and a temporary `bin` prepended to `PATH` containing an executable fake named `claude`.

The fake executable accepts real argv, observes real cwd, returns configured `plugin list --json` payloads/status/stderr, returns per-reference install outcomes, and appends invocations to a test-owned log. Assertions use only public evidence:

- process exit status and stdout/stderr;
- Project Manifest and Profile files under temporary roots;
- fake-Claude invocation log, including exact argv and cwd;
- absence of install/uninstall calls when the contract forbids them.

This seam covers project-path and scope filtering, malformed/list failures, qualified install arguments, add-only Apply, partial install failure diagnostics, Import preview-before-write, non-interactive behavior, canonical routing, and legacy warnings without importing implementation modules or mocking their functions.

Do not add store, application, presenter, or child-runner mock tests. A direct test is allowed only for a pure domain edge that cannot be observed through files, process output/status, or fake-Claude calls; record why the public seam is insufficient before adding it. Drift should normally remain covered through inspect/Apply/Import black-box scenarios.

## Incremental extraction

1. Extend the existing compiled-process test harness with temporary `cwd` plus the fake `claude` on `PATH`; characterize current behavior before moving code.
2. Extract `domain.ts` types, qualified-reference validation, and pure Drift calculation. Keep presentation behavior unchanged.
3. Extract filesystem access into `stores.ts`, injecting `HOME` and project root while preserving existing file formats and error wording where the new contract does not supersede them.
4. Add `claude-cli.ts`; move install execution into it and add validated `plugin list --json` Installed State observation.
5. Introduce `application.ts` one vertical operation at a time: inspect, Apply, preview/commit Import, then Profile/catalog operations. Route each migrated CLI command through it immediately.
6. Reduce CLI and legacy handlers to request parsing/result rendering, then switch TTY actions to those same operations.
7. Leave `index.ts` as composition and startup only. Remove old helpers only after their public black-box scenarios pass through the new path.

Each step must compile and pass the narrow CLI suite. Avoid a flag-day directory reorganization, new dependency, or simultaneous output rewrite; those changes are not needed to establish the seams.
