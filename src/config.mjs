import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export const UPSTREAM_VERSION = '1.18.1';
export const PLAYWRIGHT_VERSION = '1.58.2';

function integer(env, name, fallback, max) {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return Number(value);
}

function bool(env, name, fallback = false) {
  if (env[name] === undefined || env[name] === '') return fallback;
  if (['true', '1'].includes(env[name])) return true;
  if (['false', '0'].includes(env[name])) return false;
  throw new Error(`${name} must be true or false`);
}

export function loadConfig(env = process.env) {
  const defaultHome = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'camofox-mcp')
    : path.join(env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'camofox-mcp');
  const home = path.resolve(env.CAMOFOX_MCP_HOME || defaultHome);
  let baseUrl;
  if (env.CAMOFOX_BASE_URL) {
    let url;
    try { url = new URL(env.CAMOFOX_BASE_URL); } catch { throw new Error('CAMOFOX_BASE_URL must be an HTTP(S) URL'); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !loopback)) {
      throw new Error('CAMOFOX_BASE_URL requires HTTPS for remote servers');
    }
    if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
      throw new Error('CAMOFOX_BASE_URL cannot contain credentials, path, query or fragment');
    }
    if (!loopback && !env.CAMOFOX_ACCESS_KEY) throw new Error('Remote connection requires CAMOFOX_ACCESS_KEY');
    baseUrl = url.origin;
  }
  const upstreamEnv = {};
  for (const key of ['CAMOUFOX_EXECUTABLE', 'CAMOFOX_LOCALE', 'CAMOFOX_TIMEZONE', 'PROXY_STRATEGY', 'PROXY_PROTOCOL', 'PROXY_PROVIDER', 'PROXY_HOST', 'PROXY_PORT', 'PROXY_PORTS', 'PROXY_USERNAME', 'PROXY_PASSWORD', 'PROXY_BACKCONNECT_HOST', 'PROXY_BACKCONNECT_PORT', 'PROXY_COUNTRY', 'PROXY_STATE', 'PROXY_CITY', 'PROXY_ZIP', 'PROXY_SESSION_DURATION_MINUTES']) {
    if (env[key]) upstreamEnv[key] = env[key];
  }
  if (!!env.CAMOFOX_LOCALE !== !!env.CAMOFOX_TIMEZONE) throw new Error('CAMOFOX_LOCALE and CAMOFOX_TIMEZONE must be set together');
  return {
    mode: baseUrl ? 'connect' : 'managed', baseUrl, home,
    userId: env.CAMOFOX_USER_ID || `mcp-${randomUUID()}`,
    sessionKey: env.CAMOFOX_SESSION_KEY || 'default', persistent: Boolean(env.CAMOFOX_USER_ID),
    accessKey: env.CAMOFOX_ACCESS_KEY || '', apiKey: env.CAMOFOX_API_KEY || '', adminKey: env.CAMOFOX_ADMIN_KEY || '',
    allowAdmin: bool(env, 'CAMOFOX_MCP_ALLOW_ADMIN'),
    requestTimeoutMs: integer(env, 'CAMOFOX_MCP_REQUEST_TIMEOUT_MS', 45000, 300000),
    maxResponseBytes: integer(env, 'CAMOFOX_MCP_MAX_RESPONSE_BYTES', 8 * 1024 * 1024, 100 * 1024 * 1024),
    maxArtifactBytes: integer(env, 'CAMOFOX_MCP_MAX_ARTIFACT_BYTES', 20 * 1024 * 1024, 1024 * 1024 * 1024),
    maxArtifacts: integer(env, 'CAMOFOX_MCP_MAX_ARTIFACTS', 200, 10000),
    maxArtifactTotalBytes: integer(env, 'CAMOFOX_MCP_MAX_ARTIFACT_TOTAL_BYTES', 200 * 1024 * 1024, 10 * 1024 * 1024 * 1024),
    startupTimeoutMs: integer(env, 'CAMOFOX_MCP_STARTUP_TIMEOUT_MS', 30000, 300000),
    maxSessions: integer(env, 'CAMOFOX_MCP_MAX_SESSIONS', 10, 1000),
    maxTabsPerSession: integer(env, 'CAMOFOX_MCP_MAX_TABS_PER_SESSION', 10, 1000),
    maxTabsGlobal: integer(env, 'CAMOFOX_MCP_MAX_TABS_GLOBAL', 30, 10000),
    artifactDir: path.join(home, 'artifacts'), uploadsDir: path.join(home, 'uploads'), cookiesDir: path.join(home, 'cookies'),
    serverEntry: env.CAMOFOX_SERVER_ENTRY ? path.resolve(env.CAMOFOX_SERVER_ENTRY) : undefined,
    upstreamEnv,
  };
}
