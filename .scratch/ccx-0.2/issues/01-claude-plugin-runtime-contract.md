Type: research
Status: resolved
Blocked by: None

## Question

Which current Claude Code CLI capabilities and identifiers can ccx safely rely on for plugin discovery, installed-state inspection, installation, removal, marketplace disambiguation, and process exit semantics?

## Answer

Use qualified `plugin@marketplace` references and treat `claude plugin list --json` as the only Installed State source, filtered to project scope and the normalized current project path. Apply through `claude plugin install <reference> --scope project`; validate JSON defensively and treat every non-zero child status as failure because neither the JSON schema nor granular exit codes are versioned contracts. Never infer installation from plugin directories or caches. See [the research summary](../research/claude-plugin-runtime-contract.md).
