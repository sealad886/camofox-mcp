# Camofox MCP plugin specification

Status: approved architecture; user explicitly requested implementation on 2026-10-21.

## Outcome and scope

Create `sealad886/camofox-mcp`, npm package `@sealad886/camofox-mcp`, and a distributable plugin that supplies its own MCP server over stdio. Upstream Camofox performs browser execution behind its REST API. Include full pinned REST coverage, separate setup, managed local lifecycle, existing-server connections, release CI, and GitHub repository protections. Publication of a package or release is a separate action; CI configuration is included now.

## Architecture

```text
MCP client -> our stdio MCP server -> authenticated upstream REST -> Camoufox
                     |                         |
                explicit tools           private runtime
                fixed identity           owned process
```

Use Node 22 or newer, ESM modules, pinned MCP SDK 1.32.1, and AJV input validation. `src/config.mjs` parses settings; `src/contracts.mjs` defines the reviewed tool mapping; `src/client.mjs` performs bounded requests and translates artifacts; `src/runtime.mjs` manages installation and owned processes; `src/server.mjs` serves MCP; `src/cli.mjs` exposes setup and lifecycle commands. Keep plugin distribution under `plugin/`, separate from development A Team metadata.

## Requirements

1. Register all 46 reviewed operations from `docs/api/mcp-contract.md`, including source-discovered operations absent from upstream OpenAPI. No arbitrary method/path proxy.
2. Default each MCP instance to its own random user identity and task group. `CAMOFOX_USER_ID` explicitly selects reusable login state. Tools cannot override identity. Session close preserves stored profile unless the explicit storage reset operation is called.
3. `setup` installs a pinned upstream 1.18.1 runtime and its tested browser components into private storage. Stage installation and activate atomically only after validation. Recover interrupted setup. Never fetch a large runtime during MCP initialization.
4. Managed mode starts one owned, authenticated service on loopback, using an available ephemeral port. Record process identity and ownership. Shutdown, daemon stop, and restart never terminate a foreign process or trust a stale PID alone.
5. Existing-server mode validates an explicit endpoint, applies authentication, and never performs global lifecycle or cleanup operations unless administration was explicitly enabled. Missing optional upstream plugins return actionable capability errors.
6. Screenshot results use MCP image content. Trace/download artifacts use private local files and usable references; validate file paths and limits. Bound requests, responses, logs, and retained diagnostics. Do not expose secrets in diagnostics.
7. Disable upstream telemetry by default. Store profiles and secrets privately. Preserve profile data across upgrades and uninstall unless deletion was explicitly requested.
8. Provide documented setup, start, stop, status, doctor, upgrade, and uninstall workflows. Detect Node/npm/platform prerequisites with actionable diagnostics. Disclose optional `yt-dlp` and Linux display/VNC prerequisites; human authentication handoff is explicit.
9. CI runs tests, package-consumer validation, and relevant browser smoke checks. Release automation uses one version writer, a protected npm publish environment, trusted publishing/OIDC, and a reproducible package. Configure repository branch protections using checks that actually exist.

## Acceptance and proof boundaries

Automated unit and fixture integration tests prove validation, route coverage, failure handling, identity, artifact limits, and ownership. A packed-consumer test proves installed entrypoints and plugin-relative paths. Live local browser checks prove browser startup, navigation, snapshot references, form input, screenshot, upload/download, identity isolation, and persistent login restoration where upstream capabilities permit. Record separately any unrun platform, remote-provider, or human-interaction tests. No claim that anti-detection bypasses arbitrary challenges.

## Data and migration

This is a new repository and package; no legacy user data requires conversion. Runtime version changes retain the previous validated installation until replacement succeeds; persistent profiles live outside versioned installation directories. Never import or overwrite unrelated Homebrew/global installations.
