Type: task
Status: resolved
Blocked by: 01

## Question

What exact Docker-style command matrix, TTY flow, output contract, exit semantics, and ccx 0.1 compatibility mapping should ccx 0.2 expose?

## Answer

Use `ccx <object> <action>` for `project`, `profile`, and `plugin`, with permanent `init`, `up`, and `diff` project aliases. Commands share project-first application behavior across CLI and TTY, send results to stdout and diagnostics to stderr, use exit 0/1/2 for success/error/drift, and never prompt in a complete non-interactive invocation. ccx 0.1 routes remain executable with named deprecation replacements during 0.2 and ambiguous forms are removed in 0.3. See [the public command contract](../design/public-command-contract.md).
