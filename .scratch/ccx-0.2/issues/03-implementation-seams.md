Type: task
Status: resolved
Blocked by: 01

## Question

What is the smallest module boundary and highest public testing seam that can implement the ccx 0.2 contract without widening scope or coupling tests to internals?

## Answer

Use five cohesive modules—pure domain state/Drift, application operations and ports, filesystem stores, a validated Claude CLI adapter, and shared CLI/TTY presentation—wired by a thin `index.ts` composition root. Dependencies point inward to domain/application contracts; all expected failures use typed results, and only presentation renders them or chooses exit codes.

The primary test seam is the compiled CLI process with temporary `HOME` and project `cwd`, plus an executable fake `claude` prepended to `PATH`. Assert only exit/output, files, and the fake's argv/cwd log. Do not mock or directly test internal stores, operations, presenters, or process runners unless a pure domain edge is genuinely unobservable at that public boundary.

The module contracts, typed errors, dependency direction, and safe incremental extraction sequence are recorded in [ccx 0.2 implementation seams](../design/implementation-seams.md).
