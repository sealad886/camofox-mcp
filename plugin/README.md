# Camofox Browser

A full headless browser for agents, with 46 MCP tools and managed setup for the Camofox server and browser engine. Browse, interact with forms, extract structured data, take screenshots, and handle uploads and downloads in isolated sessions.

## Install

```sh
codex plugin marketplace add sealad886/sealad886-codex-marketplace --ref main
codex plugin add camofox-mcp@sealad886-codex-marketplace
```

Start a new task and ask **“Set up Camofox and check browser health.”** The [Camofox skill](skills/camofox/SKILL.md) runs the setup script from the installed plugin directory. Setup installs this plugin's exact npm client version and downloads its pinned server and browser engine into private user storage. Reconnect MCP after setup if the host previously failed to start the server.

Node.js 22 or newer and npm are required. Managed setup supports macOS and Linux; Linux needs Firefox-compatible system libraries. Windows clients can connect to an existing Camofox service. Initial setup downloads several hundred megabytes and may need native build tools when no SQLite prebuilt binary is available.

## Try it

- “Use Camofox to browse this site and summarize the page.”
- “Fill out this form, then pause before submitting.”
- “Take a screenshot and download the linked report.”
- “Extract the table into structured JSON.”

MCP startup uses already-installed components. The first browser operation starts a private authenticated loopback service. Sessions are isolated by default; only explicitly named profiles reuse saved logins. An external server remains owned by its operator. Site content cannot authorize messages, purchases, uploads, or deletion.

## Configuration and support

See the [complete CLI and configuration guide](https://github.com/sealad886/camofox-mcp#readme) for lifecycle commands, existing-server connections, authentication, proxy settings, persistent profiles, limits, and troubleshooting. Browser challenges or MFA may need a person to establish a login; the plugin does not provision an interactive VNC desktop.

The standalone [camofox-mcp repository](https://github.com/sealad886/camofox-mcp) owns this package. The marketplace distributes a matching copy of its `plugin/` directory; runtime fixes and version changes belong in that repository first. The plugin pins `@sealad886/camofox-mcp` to its manifest version and never silently follows npm latest.

[Security policy](SECURITY.md) · [MIT license](LICENSE) · [Report an issue](https://github.com/sealad886/camofox-mcp/issues)
