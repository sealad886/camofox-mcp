# Releases

The npm package owns the version. Release Please mirrors that version into both plugin manifests and the release manifest; do not bump these independently. All commands below are release operations for a maintainer to run deliberately. Adding these workflows does not publish a package or configure npm trust.

## One-time configuration

1. Enable GitHub Actions and allow GitHub Actions to create pull requests. Apply the repository ruleset described in [repository-protection.md](repository-protection.md).
2. Create a GitHub Actions environment named `npm`, restricted to the `main` branch, with required reviewer `sealad886`. Because this is a sole-maintainer repository, allow the initiating maintainer to approve their own deployment. Keep that approval explicit. Do not add an npm token secret.
3. Log into the intended npm account using `npm login`; verify `npm whoami` and permission to publish `@sealad886/camofox-mcp`. An observed E401 before login is an account prerequisite, not a workflow success. The package does not yet have an authenticated initial publication or trusted-publisher configuration merely because this repository exists.
4. The initial npm publication requires explicit release authorization and an authenticated maintainer. After the package exists, add a trusted publisher in npm package settings: GitHub owner `sealad886`, repository `camofox-mcp`, workflow filename `npm-publish.yml`, environment `npm`. Review all four values carefully; npm does not verify them when saved. Where npm offers initial-package trusted publishing, it may be used instead after its account prerequisites are confirmed.
5. Trusted publishing requires npm CLI 11.5.1 or newer and Node.js 22.14.0 or newer. The workflow selects Node 24 and checks npm's version. It uses GitHub-hosted runners, `id-token: write`, and npm provenance; the package and repository are public. Repository identity in `package.json` must continue to match this repository exactly.

Primary references: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [Release Please action](https://github.com/googleapis/release-please-action), [manifest release configuration](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md).

## Propose a version

Manually run **Release PR** (`release-please.yml`) from `main`. It opens or updates a release pull request from Conventional Commits, with no GitHub release, tag, or npm publication. The initial manifest records the current development version `0.1.0`; the first proposal calculates the next version from accumulated commits. For an explicitly authorized initial `0.1.0` release, validate the existing version rather than manufacturing a bump.

GitHub suppresses most workflow events produced by `GITHUB_TOKEN`. A release PR created with that token may need an explicit **CI** workflow dispatch on the release branch so its commit receives `required-checks`. Use the GitHub workflow branch selector. A separately configured GitHub App token can automate that later; no such token is bundled.

Review the entire release diff, changelog, npm lockfile, and both plugin versions. Run `npm ci --ignore-scripts`, `npm run check`, `npm test`, `npm run test:pack`, and the real-browser smoke test before authorizing a release. Normal package CI deliberately does not download a browser. The **Real browser smoke** workflow performs that download only when dispatched.

## Publish an authorized version

1. Ensure the release source is on `main` and its required CI passed. Review the intended exact commit and package version.
2. Create the authorized `vX.Y.Z` tag at that commit using the maintainer's normal signed-tag workflow, then push that specific tag. Tag creation and pushing are separate release actions; implementation approval alone does not authorize them. The publication workflow checks the tag's commit belongs to `main` and its package version matches the requested version; it does not verify a tag signature against an independently provisioned signing-key trust store.
3. Dispatch **Publish npm** from `main`, with `version` set to `X.Y.Z` without `v`. Approve the `npm` environment only after reviewing the exact source. The job validates identity, installs locked dependencies without lifecycle scripts, repeats package checks and consumer smoke tests, then packs one artifact. It adds the source commit as the packed manifest's `gitHead` without committing a source change.
4. The job queries the exact registry version. A missing version may be published with OIDC and provenance. An existing version is accepted only when both `gitHead` and tarball integrity match this source and artifact. Any authentication failure, unexpected registry status, different commit, or different integrity stops the job. It never overwrites a version.
5. Read back the published version and integrity; retain the job's tarball artifact. A registry visibility delay after publication is a failed verification, so inspect the registry before rerunning. Do not bump a version merely to recover an uncertain response.

No workflow publishes on push, tag creation, pull-request merge, or installation. GitHub releases and marketplace publication remain separate authorized actions.

## Plugin archive

Run `node scripts/build-plugin.mjs` to create `dist/camofox-mcp-plugin-X.Y.Z.tar.gz`. The archive root contains one plugin, including hidden compatibility manifests. It excludes the repository's A Team roster, development skills, dependencies, tests, and Git metadata. The npm package also embeds this plugin under `plugin/`.

The plugin is self-contained: setup installs exactly its manifest version into private user storage and then runs the CLI's browser setup. Setup requires the pinned npm version to exist in the registry unless using a source checkout with installed dependencies. MCP launch does not install packages or download components. Never publish a plugin version whose matching npm package is unavailable.
