import { randomUUID } from 'node:crypto';
import { mkdir, lstat, writeFile, readdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildRequest } from './contracts.mjs';

function redact(value, secrets) {
  let text = String(value);
  for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]');
  return text.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
}

async function readBounded(response, maximum) {
  const declared = Number(response.headers.get('content-length'));
  if (declared > maximum) { await response.body?.cancel(); throw new Error(`Response exceeds ${maximum} byte limit`); }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) { await reader.cancel(); throw new Error(`Response exceeds ${maximum} byte limit`); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}

function decodeBase64(data, maximum) {
  if (typeof data !== 'string' || data.length > Math.ceil(maximum / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    throw new Error('Invalid or oversized base64 artifact');
  }
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > maximum) throw new Error(`Artifact exceeds ${maximum} byte limit`);
  return bytes;
}

export class BrowserClient {
  constructor(config, runtime) {
    this.config = config;
    this.runtime = runtime;
    this.resources = new Map();
    this.artifactWrites = Promise.resolve();
  }

  artifact(bytes, filename, mimeType = 'application/octet-stream') {
    const operation = this.artifactWrites.then(() => this.saveArtifact(bytes, filename, mimeType));
    this.artifactWrites = operation.catch(() => {});
    return operation;
  }

  async saveArtifact(bytes, filename, mimeType) {
    if (bytes.length > this.config.maxArtifactBytes) throw new Error('Artifact exceeds configured byte limit');
    await mkdir(this.config.artifactDir, { recursive: true, mode: 0o700 });
    if ((await lstat(this.config.artifactDir)).isSymbolicLink()) throw new Error('Artifact directory cannot be a symlink');
    const lock = path.join(this.config.artifactDir, '.artifact-lock');
    try { await mkdir(lock, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') throw new Error('Artifact storage is busy; retry after the other writer finishes. If interrupted, verify no writer is active before removing .artifact-lock'); throw error; }
    try {
    const entries = await readdir(this.config.artifactDir, { withFileTypes: true });
    const files = entries.filter(entry => entry.isFile());
    let storedBytes = 0;
    for (const file of files) storedBytes += (await lstat(path.join(this.config.artifactDir, file.name))).size;
    if (files.length >= (this.config.maxArtifacts || 200) || storedBytes + bytes.length > (this.config.maxArtifactTotalBytes || 200 * 1024 * 1024)) throw new Error('Artifact storage limit reached; move or remove saved artifacts before retrying');
    const safe = path.basename(String(filename)).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'artifact.bin';
    const destination = path.join(this.config.artifactDir, `${randomUUID()}-${safe}`);
    await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
    const resource = { type: 'resource_link', uri: pathToFileURL(destination).href, name: safe, mimeType, size: bytes.length };
    this.resources.set(resource.uri, { ...resource });
    return resource;
    } finally { await rmdir(lock); }
  }

  async request(spec, signal) {
    const key = spec.auth === 'cookie' ? (this.runtime.apiKey || this.runtime.accessKey) : spec.auth === 'sensitive' ? (this.runtime.accessKey || this.runtime.apiKey) : this.runtime.accessKey;
    const headers = { accept: 'application/json, image/png, application/zip, text/plain, text/html' };
    if (key && spec.auth !== 'none') headers.authorization = `Bearer ${key}`;
    if (spec.auth === 'admin') {
      if (!this.runtime.adminKey) throw new Error('Server administration requires CAMOFOX_ADMIN_KEY');
      headers['x-admin-key'] = this.runtime.adminKey;
    }
    if (spec.body !== undefined) headers['content-type'] = 'application/json';
    let url = new URL(spec.path, `${this.runtime.baseUrl}/`);
    for (const [key, value] of Object.entries(spec.query)) url.searchParams.set(key, String(value));
    const combined = AbortSignal.any([AbortSignal.timeout(this.config.requestTimeoutMs), ...(signal ? [signal] : [])]);
    const options = { method: spec.method, headers, redirect: 'manual', signal: combined, body: spec.body === undefined ? undefined : JSON.stringify(spec.body) };
    let response = await fetch(url, options);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location'); await response.body?.cancel();
      const target = location ? new URL(location, url) : null;
      if (spec.name !== 'camofox_docs' || target?.origin !== url.origin || target.pathname !== '/docs/' || target.search || target.hash) {
        throw new Error('Unexpected upstream redirect refused');
      }
      url = target; response = await fetch(url, options);
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error('Repeated upstream redirect refused'); }
    }
    const mimeType = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
    const binary = mimeType.startsWith('image/') || mimeType === 'application/zip';
    const bytes = await readBounded(response, binary ? this.config.maxArtifactBytes : this.config.maxResponseBytes);
    if (!response.ok) {
      let detail = bytes.toString('utf8');
      try { detail = JSON.parse(detail).error || detail; } catch { /* Non-JSON upstream errors are still bounded. */ }
      const hint = response.status === 404 && /storage_state|vnc|transcript/.test(spec.path) ? ' Enable the corresponding upstream plugin to use this optional capability.' : '';
      throw new Error(`HTTP ${response.status}: ${String(detail).slice(0, 1500)}${hint}`);
    }
    return { bytes, mimeType, binary };
  }

  async shape(spec, response) {
    const { bytes, mimeType, binary } = response;
    if (binary) {
      const image = mimeType.startsWith('image/');
      const artifact = await this.artifact(bytes, image ? 'screenshot.png' : 'trace.zip', mimeType);
      if (image && bytes.length * 4 / 3 > this.config.maxResponseBytes) {
        return { content: [{ type: 'text', text: 'Image saved as an artifact; exceeds inline response limit.' }, artifact] };
      }
      return { content: [...(image ? [{ type: 'image', data: bytes.toString('base64'), mimeType }] : []), artifact] };
    }
    if (!mimeType.includes('json')) return { content: [{ type: 'text', text: bytes.toString('utf8') }] };
    const payload = JSON.parse(bytes.toString('utf8'));
    if (spec.name === 'camofox_get_storage_state') {
      const artifact = await this.artifact(bytes, 'storage-state.json', 'application/json');
      return { content: [{ type: 'text', text: 'Sensitive storage state saved locally. Treat this artifact as a credential.' }, artifact] };
    }
    const attachments = [];
    if (payload.screenshot?.data) {
      const image = decodeBase64(payload.screenshot.data, this.config.maxArtifactBytes);
      attachments.push({ type: 'image', data: image.toString('base64'), mimeType: payload.screenshot.mimeType || 'image/png' });
      delete payload.screenshot;
    }
    for (const item of [...(payload.downloads || []), ...(payload.images || [])]) {
      const encoded = item.dataBase64 ?? (item.dataUrl?.startsWith('data:') ? item.dataUrl.split(',')[1] : undefined);
      if (encoded === undefined) continue;
      const mime = item.mimeType || item.dataUrl?.match(/^data:([^;,]+)/)?.[1] || 'application/octet-stream';
      const resource = await this.artifact(decodeBase64(encoded, this.config.maxArtifactBytes), item.suggestedFilename || 'image.bin', mime);
      delete item.dataBase64; delete item.dataUrl;
      item.artifact = resource.uri; attachments.push(resource);
    }
    return { content: [{ type: 'text', text: JSON.stringify(payload) }, ...attachments] };
  }

  async call(name, args = {}, { signal } = {}) {
    try {
      const spec = buildRequest(name, args, this.config);
      if (spec.admin && !this.runtime.owned && !this.config.allowAdmin) throw new Error('Borrowed server administration is disabled; set CAMOFOX_MCP_ALLOW_ADMIN=true explicitly');
      if (args.consume && name === 'camofox_downloads' && args.includeData) throw new Error('Fetch downloads with consume=false to preserve recovery; consume in a separate call after saving artifacts');
      const response = await this.request(spec, signal);
      return await this.shape(spec, response);
    } catch (error) {
      const text = redact(error.message || error, [this.runtime.accessKey, this.runtime.apiKey, this.runtime.adminKey, this.config.upstreamEnv?.PROXY_PASSWORD]);
      return { isError: true, content: [{ type: 'text', text: `Camofox: ${text}` }] };
    }
  }
}
