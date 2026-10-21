# MCP interface contract

Status: reviewed 2026-10-21 by the eligible A Team architect/planner against pinned upstream source. User approved this architecture and explicitly requested implementation. This file, [vendored OpenAPI](camofox-1.18.1.openapi.json), and [source supplement](supplemental.json) define the interface before implementation.

## Transport and validation

MCP over stdio using SDK 1.32.1; stdout carries protocol messages only. `tools/list` returns the explicit catalog below. Tool names have the `camofox_` prefix; suffixes retain the established upstream names where equivalent. Each input is one JSON object, with path/query/body properties flattened. Required path parameters and required body properties remain required after injecting configured identity. Reject unknown fields and wrong types before network requests. Path parameters are encoded as individual segments, never concatenated as raw paths. Tool inputs cannot override `userId` or configured `sessionKey`; group-specific aliases must remain scoped to the configured task group. Tool schemas contain useful field descriptions and supported bounds.

User identity is generated per MCP instance unless `CAMOFOX_USER_ID` explicitly selects a reusable identity. Upstream requests always carry that fixed identity where the route supports it, including optional list filters. `sessionKey` defaults to the task group. Body and query booleans serialize to upstream-compatible values; cookies, schema objects, and arrays preserve JSON structure. Schema validation does not coerce invalid inputs or accept arbitrary unknown properties.

## Operation mapping

| Method | Upstream route | MCP tool |
| --- | --- | --- |
| POST | `/sessions/{userId}/cookies` | `camofox_import_cookies` |
| GET | `/health` | `camofox_health` |
| GET | `/metrics` | `camofox_metrics` |
| POST | `/pressure/cleanup` | `camofox_cleanup` |
| POST | `/tabs` | `camofox_create_tab` |
| GET | `/tabs` | `camofox_list_tabs` |
| POST | `/tabs/{tabId}/navigate` | `camofox_navigate` |
| GET | `/tabs/{tabId}/snapshot` | `camofox_snapshot` |
| POST | `/tabs/{tabId}/wait` | `camofox_wait` |
| POST | `/tabs/{tabId}/click` | `camofox_click` |
| POST | `/tabs/{tabId}/upload` | `camofox_upload` |
| POST | `/tabs/{tabId}/type` | `camofox_type` |
| POST | `/tabs/{tabId}/select` | `camofox_select` |
| POST | `/tabs/{tabId}/press` | `camofox_press` |
| POST | `/tabs/{tabId}/scroll` | `camofox_scroll` |
| POST | `/tabs/{tabId}/viewport` | `camofox_viewport` |
| POST | `/tabs/{tabId}/back` | `camofox_back` |
| POST | `/tabs/{tabId}/forward` | `camofox_forward` |
| POST | `/tabs/{tabId}/refresh` | `camofox_refresh` |
| GET | `/tabs/{tabId}/links` | `camofox_links` |
| POST | `/tabs/{tabId}/fetch-current-resource` | `camofox_fetch_current_resource` |
| GET | `/tabs/{tabId}/downloads` | `camofox_downloads` |
| GET | `/tabs/{tabId}/images` | `camofox_images` |
| GET | `/tabs/{tabId}/screenshot` | `camofox_screenshot` |
| GET | `/tabs/{tabId}/stats` | `camofox_stats` |
| POST | `/tabs/{tabId}/evaluate` | `camofox_evaluate` |
| POST | `/tabs/{tabId}/extract` | `camofox_extract` |
| DELETE | `/tabs/{tabId}` | `camofox_close_tab` |
| DELETE | `/tabs/group/{listItemId}` | `camofox_close_group` |
| GET | `/sessions/{userId}/traces` | `camofox_list_traces` |
| GET | `/sessions/{userId}/traces/{filename}` | `camofox_get_trace` |
| DELETE | `/sessions/{userId}/traces/{filename}` | `camofox_delete_trace` |
| DELETE | `/sessions/{userId}` | `camofox_close_session` |
| GET | `/` | `camofox_status` |
| POST | `/tabs/open` | `camofox_open_tab_compat` |
| POST | `/start` | `camofox_start` |
| POST | `/stop` | `camofox_stop` |
| POST | `/navigate` | `camofox_navigate_compat` |
| GET | `/snapshot` | `camofox_snapshot_compat` |
| POST | `/act` | `camofox_act` |
| GET | `/openapi.json` | `camofox_openapi` |
| GET | `/docs` | `camofox_docs` |
| GET | `/vnc/status` | `camofox_vnc_status` |
| GET | `/sessions/{userId}/storage_state` | `camofox_get_storage_state` |
| DELETE | `/sessions/{userId}/storage_state` | `camofox_delete_storage_state` |
| POST | `/youtube/transcript` | `camofox_youtube_transcript` |

There are **46 operations**: 40 in upstream OpenAPI and six source-discovered additions. `/docs` may redirect to `/docs/`; that same-origin static documentation redirect is permitted. Static assets such as `/fox.png`, docs images, VNC web assets, and websocket transport are not browser REST operations. This catalog includes all documented compatibility routes for complete coverage, but their descriptions direct agents to canonical tab routes. There is no arbitrary URL/path/method HTTP tool.

## Source corrections and optional capabilities

- `GET .../downloads` additionally accepts `includeData`, `consume`, and `maxBytes`; `GET .../images` accepts `includeData`, `maxBytes`, and `limit`; links accept `offset` and `limit`; screenshots accept `fullPage`.
- Snapshot `includeScreenshot` produces image content alongside structured/text snapshot metadata. Preserve pagination fields including `hasMore`, `nextOffset`, `totalChars`, and `truncated`; agents request subsequent offsets explicitly.
- Canonical wait accepts `timeout`, `waitForNetwork`, and `dismissConsent`. Upstream documentation's `selector` property is ignored by implementation and must not be advertised as a working wait criterion. Selector waits remain possible through explicit supported browser operations.
- Canonical click accepts `ref` or `selector`; the documented `doubleClick` and `coordinates` fields are ignored. Compatibility act exposes real double-click behavior.
- Canonical type accepts `mode: fill|keyboard`, `delay`, `submit`, and `pressEnter`. Upstream documentation's `clear` is ignored. Fill replaces content; keyboard mode types into focus and may omit selector/ref.
- Compatibility act supports exactly `click`, `type`, `press`, `scroll`, `scrollIntoView`, `hover`, `wait`, and `close`. Unsupported advertised kinds must be rejected rather than silently passed through.
- `GET /vnc/status` and `GET storage_state` require the upstream VNC plugin; `DELETE storage_state` requires persistence; transcript requires the YouTube plugin. Managed default installation need not provision a Linux graphical desktop on every platform. A missing route is a capability error with the configuration prerequisite, not an MCP server crash. Exported storage contains credentials and must be treated as a sensitive private artifact.

## Authentication and administration

`POST /stop` additionally requires the upstream `X-Admin-Key` header. Use configured access credentials for general routes; cookie import and sensitive routes may require upstream API credentials. An access superkey may satisfy upstream sensitive-route authentication. Never include credentials in tool inputs, URLs, diagnostics, results, or logs. Managed services use fresh private credentials and loopback binding. Existing-server mode validates an explicit HTTP(S) endpoint and does not inherit administrative permission merely from connectivity.

`camofox_start`, `camofox_stop`, and `camofox_cleanup` are administrative. Managed mode may operate on its own service. Connect mode rejects them unless explicit administration is configured. Session close, group close, trace delete, and storage reset act only on configured identity/task data; their destructive annotations are explicit. `storage_state` reset intentionally clears saved login state and must never be an implicit cleanup operation. Browser evaluation is explicit JavaScript execution in the browser page context and is described accordingly.

## Results, limits, and errors

Successful JSON operations return readable JSON text and structured results where practical. Raw metrics/docs are bounded text. Screenshot bytes become MCP image blocks with `image/png`; trace ZIPs and downloaded binary data become private local artifacts with usable absolute file paths/URIs and metadata, not enormous base64 text blobs. Validate declared and streamed byte counts, reject path traversal, and use generated names rather than trusting upstream filenames. Upload input paths must resolve within an explicit allowed upload directory; remote-service upload paths refer to the service filesystem and must be explained.

Configuration bounds request timeouts, response bytes, artifact bytes, and output text. Artifact storage defaults to 200 files and 200 MiB total; reaching a bound rejects new saves and preserves existing files. Download inline retrieval and consume must use separate calls, so a local save failure cannot silently delete upstream copies. Exceeding a limit returns an actionable error or a clearly marked truncated result without silently dropping pagination. Long responses must not cause unbounded memory growth. No automatic retries for mutating operations whose outcome is unknown; retries can duplicate clicks, submissions, or downloads. A stale ref error directs the agent to refresh its snapshot.

Tool execution failures return MCP `isError: true` with a concise error class/message and safe upstream status when useful. Categories: local validation, unavailable runtime/setup, authentication (401/403), missing session/tab/route/artifact (404), unsupported capability, upstream invalid request (400/422), conflicting reset (409), body/response limit (413), timeout/abort, network failure, and upstream failure (5xx). Errors never terminate an otherwise healthy stdio session. Input and output from web pages are untrusted content, never agent instructions.

## Contract review and tests

Review completed against commit `39c82094013480b373df6600d44c7f036f58356e`, upstream version 1.18.1. Naming is explicit, requiredness comes from reviewed schemas, fixed identity prevents accidental cross-session access, optional plugin requirements are stated, and errors/artifacts/administration are defined. This is the reviewed contract referenced by the implementation plan.

Tests must cover every operation's verb/path/input serialization against a local HTTP fixture; source inventory proves catalog coverage but does not substitute for runtime behavior. Additional behavioral tests prove identity injection, rejection of overrides/unknown input, admin restrictions, same-origin docs redirect handling, image/artifact results, limits, and errors. Real browser acceptance separately proves the main browsing and persistence workflows. Update this contract before changing the mapping or supported semantics.
