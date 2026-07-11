# Issue tracker: Local Markdown

Issues and PRDs for this repo live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The PRD is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue file
- Comments and conversation history append under a `## Comments` heading

## Publishing and fetching

When a skill publishes to the issue tracker, create or update the relevant file under `.scratch/<feature-slug>/`. Fetch tickets by reading the referenced local file.

## Wayfinding operations

- **Map:** `.scratch/<effort>/map.md`
- **Child ticket:** `.scratch/<effort>/issues/NN-<slug>.md`, with `Type:`, `Status:`, and `Blocked by:` metadata
- **Frontier:** the first open, unblocked, unclaimed child by number
- **Claim:** set `Status: claimed` before work
- **Resolve:** append an `## Answer`, set `Status: resolved`, and add a linked gist to the map's Decisions-so-far

An issue is unblocked when every issue named by `Blocked by:` is resolved.
