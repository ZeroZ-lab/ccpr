# ccx 0.2 public command contract

## Grammar

Canonical commands use `ccx <object> <action> [options] [arguments]`. Project operations act on the current working directory only. `init`, `up`, and `diff` are permanent high-frequency aliases for their `project` forms.

```text
ccx project init (--empty | --from-profile PROFILE) [--force]
ccx project up
ccx project diff
ccx project import [--yes]

ccx profile create [--from-project] NAME
ccx profile ls
ccx profile inspect NAME
ccx profile update (--add PLUGIN | --remove PLUGIN) NAME
ccx profile rm NAME

ccx plugin ls
ccx plugin search KEYWORD
```

All new writes require a qualified Plugin Reference (`plugin@marketplace`). Repeated manifest/profile references are normalized to the first occurrence while preserving declaration order.

## Project behavior

- `project init` creates `.ccx.json` from an explicit empty selection or a Profile. A TTY may present those choices. Existing files require interactive confirmation or `--force`.
- `project diff` compares the Project Manifest with project-scoped Installed State at the normalized current path. It prints deterministic `Missing` and `Undeclared` groups and never mutates state.
- `project up` installs only `Missing` references through `claude plugin install <reference> --scope project`. It never removes `Undeclared` references. Independent installs continue after a failure so the final report is complete.
- `project import` first prints the proposed added/removed manifest entries, then writes exactly that preview after interactive confirmation or `--yes`. It may create a missing manifest and may explicitly import an empty Installed State.

## Profile and catalog behavior

- A Profile is a user-scoped template. `profile create` creates an empty template unless `--from-project` copies the Project Manifest.
- `profile inspect` prints one qualified reference per line. `profile update` applies exactly one explicit add/remove operation in ccx 0.2. `profile rm` is non-interactive in command mode; the TTY confirms destructive actions.
- `plugin ls` and `plugin search` read marketplace catalogs for discovery. They show qualified references and never imply installation.

## TTY flow

Running `ccx` with a TTY opens a thin controller over the same application operations:

```text
current project
├─ no Project Manifest → Init empty / Init from Profile / Profiles / Plugin catalog / Exit
└─ Project Manifest → Drift summary / Up / Diff / Edit / Import / Profiles / Plugin catalog / Exit
```

The TTY has no private storage, installation, or Drift logic. Without a TTY, `ccx` with no command exits with usage guidance.

## Output and exit status

- Normal results and machine-pipeable listings go to stdout. Diagnostics, deprecation notices, and usage errors go to stderr.
- Colors and animated spinners are disabled when either stream is not a TTY or `NO_COLOR` is set.
- Exit `0`: successful operation, including an already-converged `up` or a cancelled interactive confirmation.
- Exit `1`: usage, validation, storage, Claude CLI, or partial Apply failure.
- Exit `2`: `project diff` completed successfully and Drift exists. A clean diff exits `0`; inability to calculate Drift exits `1`.
- Partial Apply prints installed and failed references separately, includes each available Claude diagnostic, does not print an unconditional success message, and exits `1`.

## Non-interactive guarantees

- Complete canonical commands never prompt.
- Non-TTY `project init` requires `--empty` or `--from-profile`; overwriting requires `--force`.
- Non-TTY `project import` requires `--yes`; without it, ccx prints the preview and exits `1` without writing.
- Missing arguments produce the canonical usage and exit `1`; unknown commands are never treated as Profile names by the canonical router.

## ccx 0.1 compatibility

ccx 0.2 executes legacy commands with unchanged data targets and emits one stderr notice naming the canonical replacement. Ambiguous routes are removed in ccx 0.3; permanent short aliases are not deprecated.

| ccx 0.1 invocation | ccx 0.2 mapping |
| --- | --- |
| `ccx init` | Permanent alias of `ccx project init` |
| `ccx install` | Deprecated alias of `ccx project up` |
| `ccx sync` | Deprecated explicit import equivalent to `ccx project import --yes` |
| `ccx save NAME` | Deprecated alias of `ccx profile create --from-project NAME` |
| `ccx install PROFILE` or `ccx PROFILE` | Deprecated direct Profile install; does not create or overwrite a Project Manifest |
| `ccx create NAME` | `ccx profile create NAME` |
| `ccx delete NAME` | `ccx profile rm NAME` |
| `ccx profiles` or `ccx list` | `ccx profile ls` |
| `ccx add PROFILE PLUGIN` | `ccx profile update --add PLUGIN PROFILE` |
| `ccx remove PROFILE PLUGIN` | `ccx profile update --remove PLUGIN PROFILE` |
| `ccx list PROFILE` | `ccx profile inspect PROFILE` |
| `ccx search KEYWORD` | `ccx plugin search KEYWORD` |
| `ccx PROFILE add [PLUGIN]` | Deprecated Profile update route; missing plugin may prompt only in a TTY |
| `ccx PROFILE remove [PLUGIN]` | Deprecated Profile update route; missing plugin may prompt only in a TTY |
| `ccx PROFILE list` | `ccx profile inspect PROFILE` |
| `ccx add NAME` | Deprecated ambiguous alias of `ccx profile create NAME` |
| `ccx remove NAME` | Deprecated ambiguous alias of `ccx profile rm NAME` |
| `ccx ui`, `ccx tui`, `ccx interactive` | TTY entry; `tui` and `interactive` are deprecated aliases |

Legacy bare plugin values remain readable so existing files do not break, but new canonical add/init/import writes reject them with migration guidance instead of guessing a marketplace.
