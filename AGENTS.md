# Camofox MCP contributor instructions

Follow INIT.md and the approved design. A Team roster is in .agent-sync/TEAM.md and ROUTING.md. Run `python3 scripts/roster.py verify` and `python3 scripts/roster.py check Agent <name>` or `check Skill <name>` before dispatch/invocation. A Team profiles in .claude/agents and skills are development-only; distributable plugin lives in plugin/.

Use a task branch in the existing checkout. Never create worktrees without individual user authorization. Preserve unrelated work. Use failing behavioral tests before implementation, run `npm test` and packed-consumer checks, obtain independent reviews. Keep stdout protocol-only. No secrets in logs or source. Do not publish npm or create release tags without explicit release authority. Commits use Conventional Commits and configured signing.

## Issues and pull requests

Create and resolve issues to coordinate work across chats and teams. A pull request can stand on its own. Link and resolve related issues when applicable. When creating a GitHub issue, set the applicable available issue fields. When planning from an issue, review its fields, description, and comments.
