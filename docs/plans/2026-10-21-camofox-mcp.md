# Implementation plan: Camofox MCP plugin

Architecture and implementation authorized by user on 2026-10-21. Reviewed interface: [MCP contract](../api/mcp-contract.md), with immutable upstream OpenAPI and source-audited `supplemental.json`. Execute in the dedicated local task branch without creating worktrees.

## Phase 1: Contract and package foundation

1. **Record interface and decisions** — Files: `docs/api/mcp-contract.md`, `docs/api/supplemental.json`, `docs/specs/2026-10-21-camofox-mcp.md`, `docs/adr/0001-own-mcp-adapter-managed-upstream.md`. Review all 46 operations and correct upstream spec/source discrepancies before implementation. Dependencies: pinned upstream source. Risk: medium.
2. **Define package and validation baseline** — Files: `package.json`, `package-lock.json`, `test/contracts.test.mjs`. Pin dependencies, establish Node 22 baseline, and add failing behavioral contract tests before implementation. Dependencies: step 1. Risk: low.
3. **Implement configuration and explicit contracts** — Files: `src/config.mjs`, `src/contracts.mjs`, `test/config.test.mjs`. Validate bounds and modes, fix identity, derive explicit input schemas, and reject unknown/overriding arguments. Dependencies: step 2. Risk: medium.

Verification: unit tests prove required fields, actual supported fields, operation coverage, fixed identities, and administration restrictions. This phase can deliver reviewed contracts plus a usable validation library.

## Phase 2: MCP browsing through an existing server

4. **Implement bounded REST transport** — Files: `src/client.mjs`, `test/client.test.mjs`. Start with failing local HTTP fixture tests for routing, authentication, timeouts, bounded responses, errors, images, and artifact handling. Implement against the contract. Dependencies: phase 1. Risk: high.
5. **Implement MCP stdio transport** — Files: `src/server.mjs`, `src/cli.mjs`, `test/server.test.mjs`. Register explicit tools, validate each call, return standard MCP results, and keep stdout protocol-only. Test discovery and representative invocations with the real SDK client. Dependencies: step 4. Risk: medium.

Verification: all mapped operations route to a deterministic fixture, screenshot image blocks work, wrong identity cannot cross sessions, and upstream errors become actionable `isError` results. This phase independently supports existing Camofox services.

## Phase 3: Managed setup and lifecycle

6. **Implement atomic private installation** — Files: `src/runtime.mjs`, `test/runtime.test.mjs`. Test missing/partial/corrupt setup and use a staging install with pinned package and browser downloader. Reuse a validated owned install; avoid mutating global installations. Dependencies: phase 1. Risk: high.
7. **Implement owned startup and cleanup** — Files: `src/runtime.mjs`, `src/cli.mjs`, `test/runtime.test.mjs`. Test ephemeral loopback startup, bounded readiness, stale metadata, occupied ports, concurrent requests, EOF/signals, and refusing foreign-process shutdown. Add setup/start/stop/status/doctor/upgrade/uninstall commands. Dependencies: step 6 and phase 2. Risk: high.
8. **Package plugin entrypoints and guide** — Files: `plugin/.codex-plugin/plugin.json`, portable manifest and MCP configuration within `plugin/`, `plugin/skills/camofox/SKILL.md`, launcher/bootstrap scripts. Ensure packaged relative paths work and document explicit initial setup. Dependencies: step 7. Risk: medium.

Verification: fixture ownership tests, `npm pack` installed-consumer smoke, and local real-browser smoke including persistence and file handling where available. This phase independently delivers a local usable plugin.

## Phase 4: Repository and release readiness

9. **Configure CI and release workflow** — Files: `.github/workflows/ci.yml`, `.github/workflows/release-please.yml`, `.github/workflows/publish.yml`, release configuration. One version writer, least-privilege jobs, npm trusted publisher and protected environment. Test package contents and document required npm trust settings. Dependencies: phase 3. Risk: high.
10. **Create repository and protections** — Repository: `sealad886/camofox-mcp`; files: `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, repository protection/setup documentation. Configure actual branch/check names and read back settings. Do not claim npm publication or a tested hosted workflow before it occurs. Dependencies: CI names known. Risk: medium.
11. **Independent review and final validation** — All changed source and CI. Have eligible code/security/infra reviewers inspect behavior and narrow findings to this requested scope. Re-run affected tests after fixes. Remove only task-generated logs/debug dumps. Dependencies: preceding steps. Risk: medium.

Verification: unit/fixture tests, MCP SDK discovery, packed consumer, live browser, workflow/package validation, and protection read-back. Report any unavailable trust configuration, unrun hosted CI, or platform gaps explicitly.

## Execution discipline

Use short RED/GREEN slices inside each step: each new test states the behavior it proves, then implement only enough to pass. Delegate runtime versus core MCP versus infrastructure when their file ownership is independent. Parent integrates and owns final validation. Keep one active checklist item; completed step claims require command output. No commits or publication beyond explicit user authorization and repository policy.

## Success criteria

- All 46 documented REST operations have explicit MCP mappings and test evidence.
- Setup, startup, identity isolation, artifacts, persistence, and cleanup satisfy the contract.
- Installed package and plugin paths work outside the source checkout.
- CI, npm release gates, GitHub repository, and repository protections are configured and their limitations reported.
