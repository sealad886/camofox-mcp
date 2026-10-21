# Verification evidence — 2026-10-21

## Local acceptance

Host: macOS arm64, Node 26.12.0. Native module and browser work ran outside the restricted shell sandbox; fixture loopback listeners are denied in that sandbox.

- `npm run test:coverage`: 98 passing, zero failing. Overall source coverage 89.82% lines, 81.19% branches, 82.79% functions. Tests include all 46 independent HTTP mappings, MCP SDK discovery, ownership, leases, authentication, failure handling, and artifact bounds.
- `npm run check`: portable/Codex manifests, YAML, contained paths, release version mirrors, and 14 JavaScript source/helper syntax checks passed.
- `actionlint .github/workflows/*.yml`: all four workflows passed.
- `npm audit --audit-level=moderate`: no vulnerabilities after pinning AJV 8.20.0 and development-only YAML 2.9.1.
- `npm run test:pack`: actual npm tarball installed in an isolated consumer; extracted standalone plugin correctly reported missing setup, then initialized MCP and discovered 46 tools using the private installed client. No browser installation required for discovery.
- `node scripts/build-plugin.mjs`: standalone plugin tar.gz built and archive entries inspected, including hidden Codex files.
- Native Codex, isolated temporary profile: marketplace discovery, installation, `plugin/read`, and `skills/list` passed. Details showed Camofox Browser, expected descriptions/prompts/artwork, one namespaced browsing skill, and the camofox MCP declaration. The user's normal Codex profile was unchanged.
- Real browser test passed through the SDK stdio client and owned background supervisor: forms/dropdowns, upload, screenshot, download and resource read, traces, two isolated users on the same service, and cookies/localStorage restored after a full service restart.
- Clean setup in a fresh private temporary home passed actual npm/native dependency installation, component download, launch verification, and atomic activation. No Homebrew reuse or external executable override was used for that check.

## Compatibility finding

Camofox 1.18.1 permits newer Playwright versions through a dependency range. An existing installation resolved Playwright 1.64.1 with the tested Camoufox 152.0.4-beta.30 engine. Ordinary browsing worked, but saved-state restoration failed on unsupported protocol field `Network.setRequestInterception.bypassServiceWorker`. An isolated installation pinned to Playwright 1.58.2 passed the full workflow, including restart persistence. Managed setup therefore pins that driver through root npm overrides and validates the resolved driver before reusing an existing installation. No existing Homebrew package or browser bundle was modified.

## Independent review and scope

Eligible A Team specialists reviewed architecture/contracts, core code/security, lifecycle, and infrastructure. Reproduced findings were corrected and retested. External CodeRabbit source upload was rejected by automatic approval review; no source was sent there. GitHub CI and its required-checks result must be inspected separately for the exact pushed revision; local checks do not establish hosted execution.

No npm package, release tag, or GitHub Release was published. Initial npm publication needs valid account access; subsequent OIDC publication also needs the package's trusted publisher to name this repository, `npm-publish.yml`, and environment `npm`. Managed Windows setup, interactive VNC desktop provisioning, real proxy providers, third-party login/MFA, and live YouTube extraction were not acceptance-tested. Optional capabilities remain explicit in the tool contract.
