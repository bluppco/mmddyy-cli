import { test, expect, spyOn } from 'bun:test';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore, authenticatedFetch, serverOrigin } from '../src/auth';

test('server selection never accepts credentials in URLs or non-loopback HTTP', () => {
  expect(serverOrigin('http://127.0.0.1:8788')).toBe('http://127.0.0.1:8788');
  for (const url of ['http://example.com', 'https://user:secret@example.com', 'https://mmddyy.app/mcp', 'https://mmddyy.app?token=x']) expect(() => serverOrigin(url)).toThrow();
});

test('missing credentials include signup and a login command for the selected server', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mmddyy-recovery-'));
  try {
    await expect(new AuthStore('http://127.0.0.1:8788', directory).access()).rejects.toMatchObject({ status: 401, recovery: {
      signup_url: 'http://127.0.0.1:8788/signup', login_command: "md --server 'http://127.0.0.1:8788' auth login",
    } });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('401 refresh retries once, while forbidden and network failures do not become signup errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mmddyy-refresh-'));
  const store = new AuthStore('https://mcp.mmddyy.app', directory);
  const seed = () => store.locked(async (_state, save) => save({ origin: store.origin, client_id: 'client', access_token: 'access', refresh_token: 'refresh', expires_at: Date.now() + 600000, scope: 'read' }));
  const fetchMock = spyOn(globalThis, 'fetch');
  try {
    await seed();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 900 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    expect((await authenticatedFetch(store)(`${store.origin}/mcp`)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockClear(); await seed();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 900 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(authenticatedFetch(store)(`${store.origin}/mcp`)).rejects.toMatchObject({ status: 401, recovery: { login_command: 'md auth login' } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockClear(); await seed();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect((await authenticatedFetch(store)(`${store.origin}/mcp`)).status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(authenticatedFetch(store)(`${store.origin}/mcp`)).rejects.toThrow('offline');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ error: 'invalid_grant' }, { status: 400 }));
    await expect(authenticatedFetch(store)(`${store.origin}/mcp`)).rejects.toMatchObject({ code: 'invalid_grant', recovery: { login_command: 'md auth login' } });
  } finally { fetchMock.mockRestore(); await rm(directory, { recursive: true, force: true }); }
});
test('credentials are isolated by origin, private, and serialized across callers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mmddyy-auth-'));
  try {
    const store = new AuthStore('https://mmddyy.app', directory);
    const other = new AuthStore('http://127.0.0.1:8788', directory);
    expect(store.path).not.toBe(other.path);
    await store.locked(async (_state, save) => save({ origin: store.origin, client_id: 'client', access_token: 'access', refresh_token: 'refresh', expires_at: Date.now() + 600000, scope: 'read' }));
    expect(await store.access()).toBe('access');
    await expect(other.access()).rejects.toMatchObject({ status: 401 });
    await Promise.all(Array.from({ length: 4 }, () => store.locked(async (state, save) => {
      await new Promise(resolve => setTimeout(resolve, 10));
      await save({ ...state!, client_id: `${state!.client_id}x` });
    })));
    expect(JSON.parse(await readFile(store.path, 'utf8')).client_id).toBe('clientxxxx');
    if (process.platform !== 'win32') expect((await stat(store.path)).mode & 0o777).toBe(0o600);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
