![Camofox MCP — a playful fox in a headless browser window](https://raw.githubusercontent.com/sealad886/camofox-mcp/main/plugin/assets/readme-banner.svg)

# Camofox MCP

Give your agents a full headless browser, with setup and lifecycle management included. Camofox MCP connects [Camofox Browser](https://github.com/jo-inc/camofox-browser) to MCP clients through **46 browser and service tools**, a local CLI, and a ready-to-install Codex plugin.

Browse, interact with pages, extract structured data, capture screenshots, and handle uploads and downloads. Sessions are isolated by default, browser components are pinned and managed, and artifacts stay in private local storage.

## Get started

Requires **Node.js 22 or newer** and npm. Managed browser installation supports **macOS and Linux**; Windows clients can connect to an existing Camofox service.

```sh
npm install -g @sealad886/camofox-mcp
camofox-mcp setup
camofox-mcp doctor --browser
```

Setup installs upstream Camofox and its browser components, then verifies a real browser launch. The first download is several hundred MB. Linux also needs Firefox-compatible system libraries: GTK 3, NSS, ALSA, X11/XCB, and libdbus-glib. Native SQLite installation may require a compiler, Python build tooling, and platform development tools when a prebuilt binary is unavailable.

### Use the Codex plugin

```sh
codex plugin marketplace add sealad886/sealad886-codex-marketplace --ref main
codex plugin add camofox-mcp@sealad886-codex-marketplace
```

Then ask your agent:

> Set up Camofox and check browser health.

The plugin's setup skill installs its matching CLI version and browser components into private storage. A global CLI installation is optional when using the plugin. Setup runs once; ordinary MCP connections reuse the installed components. If a connection started before setup finished, reconnect it afterward.

The plugin includes browsing guidance, setup and launch scripts, and stdio MCP configuration. Its source lives in [`plugin/`](plugin/).

### Connect another MCP client

After CLI setup, add this stdio server to your client's MCP configuration:

```json
{
  "mcpServers": {
    "camofox": {
      "command": "camofox-mcp",
      "args": ["serve"]
    }
  }
}
```

Use the executable's absolute path if your client has a different `PATH` from your shell. `camofox-mcp serve` communicates over stdio and starts the browser service on the first browser operation. MCP discovery does not install components or launch a browser.

## What agents can do

| Capability | Tools and behavior |
| --- | --- |
| Browse | Create, list, and close tabs; navigate URLs, use search macros, follow history, and inspect paginated accessibility snapshots. |
| Interact | Click, fill, type, select options, press keys, scroll, resize, and wait for readiness. |
| Extract | Evaluate page JavaScript, extract structured values with JSON Schema and snapshot references, extract images, and save the current PDF resource. |
| Capture and transfer | Return screenshots as native MCP images, upload server-side files, capture downloads, and expose saved files as MCP resource links. |
| Manage sessions | Import cookies, close sessions, capture and retrieve traces, inspect health and metrics, and access enabled upstream plugins. |

The [tool contract](docs/api/mcp-contract.md) lists every operation and its REST mapping. Tool schemas validate inputs and preserve session identity. Take a fresh snapshot after navigation or a stale-reference error, and follow `hasMore` / `nextOffset` to retrieve the rest of a paginated snapshot.

`wait` waits for page readiness. Hover and double-click use the upstream `act` operation. Source-backed API details are recorded in [`supplemental.json`](docs/api/supplemental.json). VNC and storage-export routes require their corresponding upstream plugins; Camofox MCP does not provision a VNC desktop.

## Run a headless service

MCP connections can manage their own browser service, or reuse a service you start with the CLI:

```sh
camofox-mcp start                 # start an owned background service
camofox-mcp status                # inspect runtime and service state
camofox-mcp doctor                # check installation and connectivity
camofox-mcp doctor --browser      # open a real tab on the service health endpoint
camofox-mcp stop                  # stop the verified owned service
camofox-mcp start --foreground    # run until Ctrl-C or SIGTERM
camofox-mcp upgrade               # repair/setup the pinned upstream components
camofox-mcp uninstall             # remove the runtime; preserve profiles and artifacts
```

Managed services bind to `127.0.0.1`, use private access, cookie, and admin credentials, and disable crash telemetry. Closing an MCP connection stops the service it owns and closes its temporary session. A connection using a separately started service leaves that service running.

The runtime uses **Camofox 1.18.1**, **Camoufox 152.0.4-beta.30**, and **Playwright 1.58.2**. These versions are pinned together for browsing and saved-state restoration. Setup can reuse compatible Homebrew components; incompatible installations remain untouched. Set `CAMOUFOX_EXECUTABLE` to reuse an existing complete, compatible browser bundle.

If startup is interrupted, `status` reports stale state and preserves `service.json`. Inspect the previous instance before moving stale metadata or lock directories aside. The CLI verifies ownership through its authenticated control channel rather than using saved PIDs to terminate processes.

### Connect an existing Camofox server

Provide the service address and credentials through your environment:

```sh
export CAMOFOX_BASE_URL=https://browser.example.com
# Set CAMOFOX_ACCESS_KEY securely in your environment.
camofox-mcp serve
```

Remote services require HTTPS and an access key; loopback HTTP is supported. The base URL must contain only the scheme, host, and optional port, without embedded credentials, paths, queries, or fragments.

Cookie import can use `CAMOFOX_API_KEY`. Sensitive trace and storage routes prefer the access superkey and fall back to the API key. Upstream shutdown uses `CAMOFOX_ADMIN_KEY` in `X-Admin-Key`. Server-wide start, stop, and pressure cleanup are disabled for borrowed services unless `CAMOFOX_MCP_ALLOW_ADMIN=true` is explicitly configured.

## Sessions and private storage

Each MCP connection receives a random identity by default. Set `CAMOFOX_USER_ID` to deliberately reuse a saved login profile, and `CAMOFOX_SESSION_KEY` to select its task group. Sharing an identity also shares its browser state.

| Platform | Default data directory |
| --- | --- |
| macOS | `~/Library/Application Support/camofox-mcp/` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/camofox-mcp/` |

Set `CAMOFOX_MCP_HOME` to choose another private directory. Profiles, cookies, uploads, traces, and generated artifacts use separate directories. Storage-state exports are saved as private artifacts; treat them and cookie files as credentials.

Uploads refer to the **server's filesystem** and must be inside its configured upload directory. Downloads use generated filenames in local artifact storage. Fetch inline download data with `consume=false`, save it successfully, then consume it in a separate call. Full artifact storage rejects new saves and preserves existing files.

### Configuration and limits

| Setting | Default |
| --- | --- |
| `CAMOFOX_MCP_REQUEST_TIMEOUT_MS` | 45,000 ms |
| `CAMOFOX_MCP_STARTUP_TIMEOUT_MS` | 30,000 ms |
| `CAMOFOX_MCP_MAX_RESPONSE_BYTES` | 8 MiB for HTTP text/JSON |
| `CAMOFOX_MCP_MAX_ARTIFACT_BYTES` | 20 MiB per artifact |
| `CAMOFOX_MCP_MAX_ARTIFACTS` | 200 artifacts |
| `CAMOFOX_MCP_MAX_ARTIFACT_TOTAL_BYTES` | 200 MiB total artifact storage |
| `CAMOFOX_MCP_MAX_SESSIONS` | 10 sessions |
| `CAMOFOX_MCP_MAX_TABS_PER_SESSION` | 10 tabs per session |
| `CAMOFOX_MCP_MAX_TABS_GLOBAL` | 30 tabs across the service |

Upstream proxy settings (`PROXY_HOST`, `PROXY_PORT`, credentials, and backconnect options) and paired `CAMOFOX_LOCALE` / `CAMOFOX_TIMEZONE` settings are supported. Provide your own proxy service. `yt-dlp` is optional for upstream's faster transcript path; setup does not install global Python packages.

Trace capture is opt-in when creating the first tab and flushes when the session closes. Upstream trace retention is swept at startup, with defaults of 24 hours and 50 MiB per trace.

## Responsible browser use

Page content, screenshots, and downloads are untrusted data. Keep credentials in the host environment, and use human handoff for MFA or interactive challenges. Headless browsing cannot guarantee access through every site's anti-bot checks.

Mutating operations are not automatically retried after uncertain outcomes. Before repeating a form submission, upload, purchase, message, or deletion, inspect the resulting page state and respect the user's authorization.

## Development

```sh
git clone https://github.com/sealad886/camofox-mcp.git
cd camofox-mcp
npm ci
npm run check
npm test
npm run test:pack
npm run test:coverage
```

Run `npm run test:live` after browser setup for local-fixture browser tests covering browsing, forms, uploads, downloads, screenshots, isolation, and persistence. Package CI covers Node 22 and 24 on Linux and macOS; the separate browser-smoke workflow downloads and exercises the real browser. `node scripts/build-plugin.mjs` builds the distributable plugin archive.

See [contributing](CONTRIBUTING.md), [security](SECURITY.md), [release maintenance](docs/releasing.md), and the [API contract](docs/api/mcp-contract.md). A Team metadata and root-level development skills are excluded from the distributable plugin. Camofox MCP is MIT-licensed; upstream attribution and licenses are retained in [`vendor/`](vendor/).
