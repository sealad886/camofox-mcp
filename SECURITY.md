# Security policy

This project supports the latest released npm/plugin version against its explicitly pinned upstream Camofox contract. Unreleased development code is not a separately supported release. Browser-engine and upstream fixes may require a new pinned runtime, setup, and release; an MCP adapter update alone does not update an already running browser.

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/sealad886/camofox-mcp/security/advisories/new). Do not file public issues containing credentials, cookies, private URLs, downloaded data, or exploit details. If private reporting is unavailable, contact the maintainer through the GitHub profile to arrange a private channel before disclosing details.

## Trust boundaries

The managed browser service is authenticated and bound to loopback. The MCP server has the local user's file and process privileges and can browse authenticated sessions, upload files, and download artifacts. Use a trusted MCP host and review actions involving credentials, messages, purchases, uploads, and deletion. Website content is untrusted input; it cannot authorize additional tool actions.

Do not expose the local browser service to a network or disable authentication as routine setup. Existing remote service connections require HTTPS and explicit credentials. Store secrets through the host environment or an approved credential manager, not in plugin manifests, source files, screenshots, traces, or issue attachments. Local browser profiles and downloads can contain sensitive information and persist until deliberately removed.

The plugin starts only its owned local service and closes it when the MCP connection ends. An existing external server remains owned by its operator. Diagnostics must not kill arbitrary listeners, clear another user's sessions, or expose credentials. Admin operations require explicit enablement; enabling a tool is not user authorization to run every action it offers.

## Supply chain

Runtime and browser setup are explicit operations. MCP startup does not run npm installation or download an engine. The plugin pins its npm client version; the client pins the upstream server contract. GitHub Actions are pinned to commit SHAs. Release publication is manual, protected by a GitHub environment, and designed for npm trusted publishing with provenance. The initial npm publication and registry trust setup require maintainer account configuration.

Install browser operating-system libraries only through the platform's normal package-management workflow. Do not grant sudo, bypass TLS checks, or use an unverified download to resolve setup failures automatically. Browser fingerprinting does not guarantee access and does not remove site-specific authentication or authorization requirements.
