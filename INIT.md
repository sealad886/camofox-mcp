# INIT.md — Camofox MCP

## O que entendi
Build a local Camofox plugin and npm CLI with our own complete MCP-to-REST bridge, pinned upstream runtime, managed setup/lifecycle, tests, release CI, and GitHub protections. Architecture and initialization explicitly approved by Andrew on 2026-10-21.

## Project Overview
New JavaScript ESM backend/CLI for Node >=22. Codex desktop/CLI is active. macOS and Linux managed runtimes; Windows existing-server connection supported, managed runtime verified separately. No LLM API calls, database, payment, or child-data processing. Browser credentials remain local; no telemetry by default.

## Languages & Stack
JavaScript ESM, Node built-in test runner, MCP SDK v1, JSON Schema validation, npm lockfile, GitHub Actions. Python only for canonical A Team development roster tooling.

## Non-Negotiable Rules
Use upstream Camofox REST server; own MCP bridge. Loopback by default; no implicit runtime downloads during MCP startup. Private local storage. Isolated sessions. Bound responses and request time. Never stop foreign processes. Preserve profiles. No worktrees without individual user authorization. Dedicated branch in this new checkout. No npm publication or release tag during implementation.

## Approved Active Work
Initialize metadata, contract/plan/ADR; implement MCP, setup/lifecycle; verify real browser and packed consumer; create standalone public GitHub repo, push implementation and configure protection/CI. npm package identity @sealad886/camofox-mcp.
