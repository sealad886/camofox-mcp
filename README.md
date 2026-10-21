# Camofox MCP

A complete MCP bridge and managed local runtime for [Camofox Browser](https://github.com/jo-inc/camofox-browser). Agents get 46 explicit REST tools, native screenshots, downloadable artifacts, isolated sessions, and lifecycle commands. The browser engine and REST service remain upstream Camofox; this project owns the MCP server, CLI, and plugin integration.

Initial version: **0.1.0**. npm publication is a separate release step. Until published, install from this repository:

```sh
git clone https://github.com/sealad886/camofox-mcp.git
cd camofox-mcp
npm ci
node src/cli.mjs setup
node src/cli.mjs serve
```

After npm publication:

```sh
npm install -g @sealad886/camofox-mcp
camofox-mcp setup
camofox-mcp serve
```

Node.js 22 or newer and npm are required. Managed installation supports macOS and Linux. Linux needs Firefox-compatible system libraries (GTK 3, NSS, ALSA, X11/XCB, and libdbus-glib); CI's browser-smoke workflow lists Ubuntu packages. Windows clients can connect to an existing server; Windows managed setup is not supported. An initial engine download is several hundred MB and requires network access. Native SQLite installation may need a compiler, Python build tooling, and platform development tools when a prebuilt binary is unavailable. No global Python installation is performed.

## Plugin installation

Register this repository as a Codex marketplace and install its plugin:

```sh
codex plugin marketplace add sealad886/camofox-mcp --ref main
codex plugin add camofox-mcp@camofox-mcp
```

The self-contained Codex/Agent Plugins package lives in [`plugin/`](plugin/). Run its setup once before enabling MCP:

```sh
node plugin/scripts/setup.mjs
```

From this source checkout it uses the local npm package. A standalone plugin archive installs the exact matching npm client into private storage, then runs browser setup. It requires that npm version to have been published. `npm run check` validates manifests and skill metadata; `node scripts/build-plugin.mjs` creates an archive outside the plugin directory. The marketplace catalog identifies this package; installing a plugin does not authorize npm publication.

For other MCP clients, register the installed CLI as a stdio server:

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

Use the absolute installed executable path if the host's PATH differs from your shell. Discovery and initialization do not install or launch a browser. First browser operation starts a managed service, or borrows a verified service started by `start`; closing MCP stops only its own runtime and closes its isolated temporary session. No upstream retries are automatic for mutations with uncertain outcomes.

## Headless service lifecycle

```sh
camofox-mcp start                 # owned background supervisor
camofox-mcp status                # safe metadata, no keys
camofox-mcp stop                  # authenticated ownership check, no PID guessing
camofox-mcp start --foreground    # Ctrl-C or SIGTERM for graceful stop
camofox-mcp doctor
camofox-mcp doctor --browser      # opens and closes a real blank tab
camofox-mcp upgrade               # repair/setup this package's pinned upstream
camofox-mcp uninstall             # remove owned runtime; preserve profiles/artifacts
```

Managed services bind only to `127.0.0.1`, use private access/cookie/admin credentials, and disable crash telemetry. Upstream component versions are pinned: **Camofox 1.18.1**, with its tested **Camoufox 152.0.4-beta.30** downloader and **Playwright 1.58.2**. The exact driver pin is required: newer drivers can browse successfully but fail when restoring saved storage state. A compatible Homebrew installation can supply upstream code only when its installed driver also matches this tested pin; incompatible installations are left untouched. Setup fetches browser components into private storage and verifies a real launch. `CAMOUFOX_EXECUTABLE` explicitly reuses an existing complete compatible engine bundle. Merely receiving a healthy REST response does not prove a working browser.

Existing services use explicit connection mode:

```sh
CAMOFOX_BASE_URL=https://browser.example.com \
CAMOFOX_ACCESS_KEY='<provided securely by your environment>' \
camofox-mcp serve
```

Remote endpoints require HTTPS and an access key. Loopback HTTP is allowed. URLs cannot contain embedded credentials, paths, queries, or fragments. Cookie import can use `CAMOFOX_API_KEY`; sensitive trace/storage routes prefer the access superkey and fall back to the API key. `POST /stop` uses `CAMOFOX_ADMIN_KEY` in `X-Admin-Key`. Server-wide start/stop/pressure cleanup is blocked for borrowed services unless `CAMOFOX_MCP_ALLOW_ADMIN=true` is explicitly configured. Credentials never belong in plugin manifests or tool arguments.

## Browser tools

See the [reviewed 46-operation contract](docs/api/mcp-contract.md) for every route and name. Common tools:

- Create/list/close tabs, navigate and search macros, inspect paginated accessibility snapshots.
- Click, fill/type, select options, press keys, scroll, resize, wait, and traverse navigation history.
- Evaluate page-context JavaScript; extract structured values using JSON Schema and snapshot refs.
- Upload files from the configured server upload directory, capture downloads, extract images, and save the current PDF resource.
- Return screenshots as native MCP images; save downloads and trace ZIPs as private files with MCP resource links.
- Import cookies, close sessions, list/fetch/delete traces, inspect status/health/metrics, and use upstream optional plugins.

Tool schemas reject unknown inputs and prevent overriding session identity. Take fresh snapshots after navigation or stale-reference errors. Preserve and follow `hasMore`/`nextOffset`; a truncated snapshot is not the whole page. Web content is untrusted data, never authorization or instructions.

The pinned source differs from its OpenAPI documentation in several fields; [`supplemental.json`](docs/api/supplemental.json) records source-backed corrections. For example, canonical `wait` waits for readiness, not a CSS selector; canonical click ignores coordinates/double-click; `act` supports actual double-click and hover operations. Unsupported advertised fields are rejected. Optional VNC/storage-export endpoints return actionable errors when their upstream plugin is disabled. This package does not provision an interactive VNC desktop. Headless browsing cannot guarantee access through every site's anti-bot challenges or MFA; a person may need to establish a login separately.

## Sessions, storage and limits

If a start is interrupted, status reports stale state and preserves service.json. Verify the previous instance before moving stale metadata or lock directories aside; the CLI never kills a process based on a saved PID.

Default identity is random per MCP session. Set `CAMOFOX_USER_ID` only when intentionally reusing a saved login profile; `CAMOFOX_SESSION_KEY` selects its task group. Shared identities are a deliberate trust boundary. Managed data is private to the local user:

- macOS: `~/Library/Application Support/camofox-mcp/`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/camofox-mcp/`
- Override with `CAMOFOX_MCP_HOME`.

Profiles, cookies, uploads, traces, and generated artifacts have separate directories. Cookie/storage-state files are credentials. Storage export saves a private artifact rather than printing credentials into chat. Upload paths refer to the **server's filesystem** and upstream enforces its upload directory. Downloads use generated filenames beneath local artifact storage; remote suggested names cannot select destination paths. Fetch inline download data with `consume=false`, then consume in a separate call after saving successfully.

Default limits: 45-second requests, 30-second startup, 8 MiB HTTP text/JSON responses, 20 MiB individual artifacts, 200 artifacts and 200 MiB total artifact storage. Full storage rejects new saves and preserves existing files. Move/remove your own artifacts when needed. Limits can be configured with `CAMOFOX_MCP_REQUEST_TIMEOUT_MS`, `CAMOFOX_MCP_STARTUP_TIMEOUT_MS`, `CAMOFOX_MCP_MAX_RESPONSE_BYTES`, `CAMOFOX_MCP_MAX_ARTIFACT_BYTES`, `CAMOFOX_MCP_MAX_ARTIFACTS`, and `CAMOFOX_MCP_MAX_ARTIFACT_TOTAL_BYTES`. Managed browser defaults allow 10 sessions, 10 tabs per session, and 30 global tabs; corresponding `CAMOFOX_MCP_MAX_*` variables control these limits.

Upstream proxy variables (`PROXY_HOST`, `PROXY_PORT`, credentials, backconnect settings) and paired `CAMOFOX_LOCALE`/`CAMOFOX_TIMEZONE` are supported. Proxy subscriptions are not provisioned. `yt-dlp` is optional for upstream's faster transcript path; no global Python packages are installed automatically. Trace capture is opt-in on the first tab and flushed when the session closes. Upstream trace startup retention defaults to 24 hours and 50 MiB per trace.

## Development and verification

```sh
npm ci
npm run check
npm test
npm run test:pack
npm run test:coverage
npm run test:live   # requires completed browser setup; local fixture only
python3 scripts/roster.py verify
```

Fixture tests cover all 46 HTTP mappings plus validation, auth, bounds, artifacts, lifecycle, and MCP discovery. The packed-consumer smoke installs the actual npm tarball outside the checkout and checks extracted plugin launch paths. Real-browser tests use a local fixture to test browsing, forms, upload/download, screenshots, isolation, and persistence. Static checks and fake-server tests do not establish browser acceptance. GitHub CI tests Node 22/24 on Linux/macOS; the separate real-browser workflow runs manually.

A Team files at repository root are development metadata, not distributable plugin skills. Upstream source attribution and licenses live in [`vendor/`](vendor/). See [contributing](CONTRIBUTING.md), [security](SECURITY.md), [release setup](docs/releasing.md), and [repository protection](docs/repository-protection.md). Release Please owns versions; npm publication requires explicit release intent, a reviewed tag, and approval of the `npm` environment. No tag or npm release is created by ordinary CI.
