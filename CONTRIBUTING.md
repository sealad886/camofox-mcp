# Contributing

Use Node >=22 and npm with the committed lockfile. Read AGENTS.md, INIT.md, and docs/api/mcp-contract.md. Keep the bridge grounded in the pinned upstream source. Update the reviewed supplemental contract before altering a route, supported input, authentication rule, or response behavior.

Work on a dedicated branch in the current checkout; worktrees require explicit individual authorization. Preserve unrelated changes. Write failing behavioral tests before implementation. Run npm run check, npm test, npm run test:pack, and appropriate browser tests. Do not describe fixture/static success as live-browser acceptance. Obtain independent code/security/infra review for affected paths.

Use signed Conventional Commits. Changes need a pull request, current required checks, and resolved conversations. The sole repository owner may explicitly bypass under the documented policy. Never publish npm, create release tags, or alter remote protections solely because a commit or implementation was authorized.

package.json is the release unit. Release Please writes versions and mirrors plugin manifests; do not add a second version writer. Never include tokens, cookie jars, profiles, downloaded browser binaries, generated runtime state, node_modules, or diagnostic dumps in commits or archives.
