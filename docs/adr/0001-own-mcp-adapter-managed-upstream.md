# ADR-0001: Own the MCP interface and manage pinned upstream Camofox

## Status
Accepted by user on 2026-10-21.

## Context
Upstream Camofox provides a broad REST API and a smaller MCP adapter. The requested plugin needs all REST functionality, predictable installation, isolated agent sessions, lifecycle ownership, and independent npm distribution. Reimplementing browser execution would duplicate upstream work.

## Decision
Implement one MCP server inside this repository, backed by Camofox 1.18.1 at commit `39c82094013480b373df6600d44c7f036f58356e`. Preserve upstream browser execution and persistence mechanisms. Expose explicit reviewed tools whose input schemas derive from vendored OpenAPI plus source-audited corrections. Review contract changes before updating the supported upstream version.

Separate setup from MCP initialization. Managed mode owns one private loopback service per MCP process; explicitly configured existing-server mode supports shared deployments. Fix user identity at process configuration, random by default, reusable only when configured. Keep saved profiles outside versioned installations. Administrative tools are unavailable or rejected for existing services unless explicitly enabled. Plugin manifests launch the packaged CLI without downloading browser components during the MCP handshake.

## Consequences

### Positive
- Complete agent tooling without maintaining browser internals.
- Clear service ownership, session isolation, and recoverable setup.
- One package, version, contract, and release process.
- Existing deployments remain usable through the same tool interface.

### Negative
- The project owns REST-to-MCP contract maintenance and validation.
- Upstream optional plugin availability differs by platform and deployment.
- One owned service per agent uses more resources than sharing a daemon; explicit existing-server mode handles that trade-off.

### Alternatives considered
- **Upstream MCP adapter only:** incomplete REST coverage and unmanaged server startup.
- **Two MCP adapters together:** duplicate operations and ambiguous ownership.
- **Browser-engine fork:** unnecessary maintenance and upgrade divergence.
- **Hosted service first:** expands infrastructure and credential scope beyond this local plugin.

## Scaling
Current design serves individual agents. Browser processes, memory, and upstream session/tab limits become the first bottlenecks. Multiple agents can explicitly connect to a separately managed shared service with distinct fixed user identities; automatic fleet orchestration is outside initial scope.

## Rollback
Keep the prior validated runtime until new setup succeeds. Stop only owned processes before switching versions. Preserve profiles and configuration, and install the previous npm package version when reverting MCP behavior. Never rollback by rewriting Git history or deleting user data.

## Date
2026-10-21
