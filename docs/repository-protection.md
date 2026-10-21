# Repository protection

The desired branch ruleset is stored in [`.github/rulesets/default.json`](../.github/rulesets/default.json). This file is a reviewable configuration source; its presence does not apply GitHub settings. Apply it with GitHub's repository-ruleset API after the repository and `main` branch exist, then read the ruleset back to confirm the effective settings.

The active ruleset targets `refs/heads/main` and requires:

- Pull requests, resolved review conversations, and dismissal of stale approvals.
- Zero mandatory human approvals, because `sealad886` is the sole maintainer. CODEOWNERS records ownership without requiring an impossible self-approval.
- Signed commits.
- A successful `required-checks` CI result with the branch up to date. That aggregate job requires the full Node 22/24 and Ubuntu/macOS matrix, including package contracts, tests, isolated npm-consumer smoke checks, and plugin packaging.
- No force pushes and no branch deletion.

Repository administrators have an explicit always-available bypass (`RepositoryRole` ID 5), matching the sole owner's recovery needs. Bypass use is a deliberate maintainer action, not a normal agent workflow. The ruleset does not silently grant a bot a bypass or permit agents to push directly to main.

Also configure the repository to use read-only default workflow permissions, allow workflow-created pull requests for Release Please, disable force-push/deletion defaults, enable vulnerability alerts and automated security fixes where supported, and enable private vulnerability reporting. These are API settings rather than workflow YAML. Dependabot configuration covers npm and pinned GitHub Actions weekly. No credentials belong in source.

The `npm` environment must have an explicit required reviewer and allow deployments only from the protected `main` branch. Publication requires an explicit manual workflow dispatch and a reviewed exact version/tag. npm's trusted publisher must separately name this repository, `npm-publish.yml`, and environment `npm`; GitHub protection alone does not establish that trust.

For newly created repositories, bootstrap the initial authorized signed commit and `main` branch before enabling checks that require an existing commit context. Never disable an existing protection merely to bypass a failing check. After the first CI run, confirm the exact `required-checks` context is reported and enforced. Ruleset and environment application must be verified live and reported separately from local JSON validation.

## Applied settings (2026-10-21)

Live API read-back confirmed repository `sealad886/camofox-mcp` is public; main ruleset `25530588` is active, with `required-checks`, PR/thread/signature requirements, deletion and force-update blocks, and explicit administrator bypass. Release-tag ruleset `25530865` is active for `refs/tags/v*`, blocking updates, non-fast-forward changes and deletion except explicit administrator action. Its source is [release-tags.json](../.github/rulesets/release-tags.json).

The npm environment has `sealad886` as required reviewer and a custom branch policy allowing only `main`. Workflow token defaults are read-only; workflow-created PRs are enabled for the manually invoked Release Please workflow. Vulnerability alerts, automated security updates, secret scanning/push protection, and private vulnerability reporting are enabled. These settings do not authorize an agent to publish, bypass protections, or merge.
