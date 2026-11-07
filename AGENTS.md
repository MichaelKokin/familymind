# FamilyMind — public source checkout

Read README.md and the relevant technical module docs before changing code. Preserve existing work. The public checkout contains synthetic examples only; keep real family material, email, notes, credentials and runtime sessions outside Git.

- Preserve Source/Artifact, Claim, EvidenceLink, ReviewDecision and Canvas layout as distinct objects.
- Evidence status and user approval are independent. Accepting a proposal does not establish historical truth.
- Preserve contradictions, uncertain dates, original names and source references. Never invent records or relationships.
- Keep the loopback-only server and server-side case/object authorization. Do not weaken access to make a demo work.
- Use the existing Next.js/React/TypeScript stack and pinned lockfile. Read `node_modules/next/dist/docs/` for version-specific APIs.
- User-facing strings belong in `src/i18n/`; initial interface is Russian.
- Model answers must come from real verified calls. Automatic external search is currently unavailable; fake CLI fixtures are for tests only.
- Before code changes, inspect `git status`. Run relevant tests, lint, typecheck and build; browser suites require a completed build and use ports 3001/3002, not the user's server 3000.
- Document actual tests and limitations in `docs/IMPLEMENTATION_STATUS.md`. Avoid copying private source material into reports or screenshots.
- Preserve third-party license notices and `vendor/ex-ussr-kinship-research/PROVENANCE.json`.

This public source checkout is maintained separately from internal project documents and private family storage. Public source availability does not make private data public and does not constitute a ready multi-user deployment.
