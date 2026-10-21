import { readFileSync } from 'node:fs';
import Ajv from 'ajv';

const upstream = JSON.parse(readFileSync(new URL('../docs/api/camofox-1.18.1.openapi.json', import.meta.url)));
const supplemental = JSON.parse(readFileSync(new URL('../docs/api/supplemental.json', import.meta.url)));
const names = {
  'POST /sessions/{userId}/cookies': 'import_cookies', 'GET /health': 'health',
  'GET /metrics': 'metrics', 'POST /pressure/cleanup': 'cleanup',
  'POST /tabs': 'create_tab', 'GET /tabs': 'list_tabs',
  'DELETE /tabs/{tabId}': 'close_tab', 'DELETE /tabs/group/{listItemId}': 'close_group',
  'GET /sessions/{userId}/traces': 'list_traces',
  'GET /sessions/{userId}/traces/{filename}': 'get_trace',
  'DELETE /sessions/{userId}/traces/{filename}': 'delete_trace',
  'DELETE /sessions/{userId}': 'close_session', 'GET /': 'status',
  'POST /tabs/open': 'open_tab_compat', 'POST /start': 'start', 'POST /stop': 'stop',
  'POST /navigate': 'navigate_compat', 'GET /snapshot': 'snapshot_compat', 'POST /act': 'act',
  'GET /sessions/{userId}/storage_state': 'get_storage_state',
  'DELETE /sessions/{userId}/storage_state': 'delete_storage_state',
  'POST /youtube/transcript': 'youtube_transcript', 'GET /vnc/status': 'vnc_status',
  'GET /openapi.json': 'openapi', 'GET /docs': 'docs',
};
for (const action of ['navigate', 'snapshot', 'wait', 'click', 'upload', 'type', 'select', 'press', 'scroll',
  'viewport', 'back', 'forward', 'refresh', 'links', 'fetch-current-resource', 'downloads',
  'images', 'screenshot', 'stats', 'evaluate', 'extract']) {
  const method = ['snapshot', 'links', 'downloads', 'images', 'screenshot', 'stats'].includes(action) ? 'GET' : 'POST';
  names[`${method} /tabs/{tabId}/${action}`] = action.replaceAll('-', '_');
}

function merge(base = {}, extra = {}) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(extra)) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? merge(result[key], value) : structuredClone(value);
  }
  return result;
}

function operationContract(path, method, definition = {}, extra = {}) {
  const contract = merge(definition, extra);
  const params = new Map((definition.parameters || []).map(p => [`${p.in}:${p.name}`, p]));
  for (const param of extra.parameters || []) params.set(`${param.in}:${param.name}`, param);
  contract.parameters = [...params.values()];
  const body = contract.requestBody?.content?.['application/json']?.schema || { type: 'object', properties: {} };
  for (const key of extra['x-remove-body-properties'] || []) delete body.properties?.[key];
  // Source confirms these advertised fields are ignored by the canonical click route.
  if (path === '/tabs/{tabId}/click') {
    delete body.properties.doubleClick;
    delete body.properties.coordinates;
  }
  const properties = {}, required = new Set();
  for (const [key, value] of Object.entries(body.properties || {})) {
    if (!['userId', 'sessionKey', 'listItemId'].includes(key)) properties[key] = value;
  }
  for (const key of body.required || []) if (key in properties) required.add(key);
  for (const param of contract.parameters) {
    if (param.name === 'userId') continue;
    properties[param.name] = structuredClone(param.schema || { type: 'string' });
    if (param.in === 'path') properties[param.name] = { type: 'string', minLength: 1, maxLength: 255 };
    if (properties[param.name].enum?.join(',') === 'true,false') properties[param.name] = { type: 'boolean' };
    if (param.required) required.add(param.name);
  }
  const name = names[`${method} ${path}`];
  if (!name) throw new Error(`Unmapped REST operation: ${method} ${path}`);
  const admin = ['/start', '/stop', '/pressure/cleanup'].includes(path);
  return {
    name: `camofox_${name}`, path, method, parameters: contract.parameters, bodySchema: body,
    auth: path === '/health' ? 'none' : path.endsWith('/cookies') ? 'cookie' : path === '/stop' ? 'admin' : path.includes('/traces') || path.includes('/storage_state') ? 'sensitive' : 'access',
    admin, inputSchema: { type: 'object', properties, required: [...required], additionalProperties: false },
    description: `${contract.summary || name}.${admin ? ' Server-wide operation; requires explicit administration in connect mode.' : ''}${path.includes('storage_state') || path.includes('/vnc/') ? ' Optional upstream plugin; may return unavailable when disabled.' : ''}${['act','open_tab_compat','navigate_compat','snapshot_compat'].includes(name) ? ' Upstream alternate route; prefer canonical tab tools.' : ''}`,
    annotations: { readOnlyHint: method === 'GET' && !path.endsWith('/downloads'), destructiveHint: method === 'DELETE' || admin, openWorldHint: true },
  };
}

const allPaths = new Set([...Object.keys(upstream.paths), ...Object.keys(supplemental.paths)]);
export const operations = [...allPaths].flatMap(path => {
  const methods = new Set([...Object.keys(upstream.paths[path] || {}), ...Object.keys(supplemental.paths[path] || {})]);
  return [...methods].filter(m => ['get', 'post', 'delete', 'put', 'patch'].includes(m))
    .map(m => operationContract(path, m.toUpperCase(), upstream.paths[path]?.[m], supplemental.paths[path]?.[m]));
});
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
const validators = new Map(operations.map(op => [op.name, ajv.compile(op.inputSchema)]));

export function buildRequest(name, args, identity) {
  const op = operations.find(o => o.name === name);
  if (!op) throw new Error(`Unknown tool: ${name}`);
  const validate = validators.get(name);
  if (!validate(args)) throw new Error(`Invalid arguments: ${ajv.errorsText(validate.errors, { dataVar: 'arguments' })}`);
  if (op.name === 'camofox_close_group' && args.listItemId !== identity.sessionKey) throw new Error('Invalid arguments: listItemId must match configured task group');
  const pathValues = { ...args, userId: identity.userId };
  const path = op.path.replace(/\{([^}]+)\}/g, (_, key) => {
    const value = String(pathValues[key]);
    if (['.', '..'].includes(value)) throw new Error('Invalid arguments: path segments cannot be dot segments');
    return encodeURIComponent(value);
  });
  const query = {}, body = {};
  for (const param of op.parameters) {
    const value = param.name === 'userId' ? identity.userId : args[param.name];
    if (param.in === 'query' && value !== undefined) query[param.name] = value;
  }
  for (const key of Object.keys(op.bodySchema.properties || {})) {
    if (key === 'userId') body[key] = identity.userId;
    else if (key === 'sessionKey') body[key] = identity.sessionKey;
    else if (key === 'listItemId' && !Object.hasOwn(op.bodySchema.properties, 'sessionKey')) body[key] = identity.sessionKey;
    else if (key !== 'listItemId' && args[key] !== undefined) body[key] = args[key];
  }
  return { ...op, path, query, body: ['POST', 'PUT', 'PATCH'].includes(op.method) ? body : undefined };
}
