import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rename, open, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import lockfile from 'proper-lockfile';
import { z } from 'zod';

export class CliError extends Error {
  constructor(message: string, readonly code = 'request_failed', readonly status = 500) { super(message); }
}
const credentialsSchema = z.object({ origin: z.string(), client_id: z.string(), access_token: z.string(), refresh_token: z.string(), expires_at: z.number(), scope: z.string() });
type Credentials = z.infer<typeof credentialsSchema>;
const tokensSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number().positive(), scope: z.string().optional() });
export function serverOrigin(value = 'https://mcp.mmddyy.app') {
  let url: URL;
  try { url = new URL(value); } catch { throw new CliError('Use a valid server origin.', 'invalid_input', 400); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new CliError('Use an HTTPS server origin, or HTTP on loopback for development.', 'invalid_input', 400);
  return url.origin;
}
export class AuthStore {
  readonly path: string;
  readonly directory: string;
  constructor(readonly origin: string, directory = process.env.MMDDYY_CONFIG_DIR ?? join(process.env.XDG_CONFIG_HOME ?? (process.platform === 'win32' ? process.env.APPDATA ?? homedir() : join(homedir(), '.config')), 'mmddyy')) {
    this.directory = directory;
    this.path = join(directory, `${createHash('sha256').update(origin).digest('hex')}.json`);
  }
  async locked<T>(fn: (state: Credentials | null, save: (state: Credentials | null) => Promise<void>) => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    try { const file = await open(this.path, 'wx', 0o600); await file.writeFile('null'); await file.close(); }
    catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error; }
    const release = await lockfile.lock(this.path, { realpath: false, stale: 120000, update: 10000, retries: { retries: 40, minTimeout: 100, maxTimeout: 500 } });
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8'));
      const current = raw === null ? null : credentialsSchema.parse(raw);
      if (current && current.origin !== this.origin) throw new CliError('Credentials belong to a different server.', 'unauthorized', 401);
      return await fn(current, async state => {
        const temp = `${this.path}.${randomBytes(12).toString('hex')}.tmp`;
        await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
        await rename(temp, this.path);
        await chmod(this.path, 0o600);
      });
    } finally { await release(); }
  }
  async access(failedToken?: string) {
    return this.locked(async (state, save) => {
      if (!state) throw new CliError('Run mmddyy auth login first.', 'unauthorized', 401);
      if (state.expires_at > Date.now() + 60000 && (!failedToken || failedToken !== state.access_token)) return state.access_token;
      const response = await oauth(this.origin, '/oauth/token', new URLSearchParams({ grant_type: 'refresh_token', refresh_token: state.refresh_token, client_id: state.client_id, resource: `${this.origin}/mcp` }));
      const tokens = tokensSchema.parse(response);
      const next = { ...state, ...tokens, scope: tokens.scope ?? state.scope, expires_at: Date.now() + tokens.expires_in * 1000 };
      await save(next);
      return next.access_token;
    });
  }
  async logout() {
    await this.locked(async (state, save) => {
      if (state) await oauth(this.origin, '/oauth/token', new URLSearchParams({ token: state.refresh_token, token_type_hint: 'refresh_token', client_id: state.client_id }));
      await save(null);
    });
  }
}

async function oauth(origin: string, path: string, body: URLSearchParams | Record<string, unknown>) {
  const form = body instanceof URLSearchParams;
  const response = await fetch(`${origin}${path}`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }, body: form ? body.toString() : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new CliError(result.error === 'invalid_grant' ? 'This connection expired or was interrupted. Run mmddyy auth login again.' : typeof result.error_description === 'string' ? result.error_description : 'Authorization request failed.', String(result.error ?? 'authorization_failed'), response.status);
  return result;
}

export async function login(store: AuthStore, noBrowser = false) {
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let complete!: (code: string) => void, fail!: (error: Error) => void;
  const callback = new Promise<string>((resolve, reject) => { complete = resolve; fail = reject; });
  // The promise may reject before registration finishes; attach a handler immediately.
  void callback.catch(() => {});
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/callback' || url.searchParams.get('state') !== state || url.searchParams.get('iss') !== store.origin) {
      response.writeHead(400).end('Invalid authorization callback.'); return;
    }
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    if (url.searchParams.has('error')) { response.end('Connection cancelled. You can close this window.'); fail(new CliError('Connection cancelled.', 'access_denied', 403)); }
    else if (url.searchParams.get('code')) { response.end('Connected. You can close this window.'); complete(url.searchParams.get('code')!); }
    else response.writeHead(400).end('Missing authorization code.');
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to listen for authorization callback.');
  const redirectUri = `http://127.0.0.1:${address.port}/callback`;
  const timeout = setTimeout(() => fail(new CliError('Login timed out. Run mmddyy auth login again.', 'login_timeout', 401)), 600000);
  try {
    const client = await oauth(store.origin, '/oauth/register', { client_name: 'mmddyy CLI', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
    const clientId = z.string().parse(client.client_id);
    const authorize = new URL('/oauth/authorize', store.origin);
    authorize.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: 'read write sharing', state, code_challenge: challenge, code_challenge_method: 'S256', resource: `${store.origin}/mcp` }).toString();
    process.stderr.write(`Open this URL to sign in:\n${authorize}\n`);
    if (!noBrowser) {
      const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
      const child = spawn(command, process.platform === 'win32' ? ['url.dll,FileProtocolHandler', authorize.toString()] : [authorize.toString()], { stdio: 'ignore', detached: true });
      child.on('error', () => process.stderr.write('Open the URL above in your browser.\n')); child.unref();
    }
    const code = await callback;
    const tokens = tokensSchema.parse(await oauth(store.origin, '/oauth/token', new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri, resource: `${store.origin}/mcp` })));
    await store.locked(async (_previous, save) => save({ origin: store.origin, client_id: clientId, access_token: tokens.access_token, refresh_token: tokens.refresh_token, scope: tokens.scope ?? '', expires_at: Date.now() + tokens.expires_in * 1000 }));
  } finally {
    clearTimeout(timeout);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

export function authenticatedFetch(store: AuthStore) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const original = new Request(input, init);
    if (new URL(original.url).origin !== store.origin) throw new CliError('Refusing to send credentials to another server.', 'invalid_origin', 400);
    const send = (token: string) => {
      const request = new Request(original.clone(), { redirect: 'error' });
      request.headers.set('Authorization', `Bearer ${token}`);
      return fetch(request);
    };
    const token = await store.access();
    const response = await send(token);
    if (response.status !== 401) return response;
    await response.body?.cancel();
    return send(await store.access(token));
  };
}
