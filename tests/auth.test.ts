import { test, expect } from 'bun:test';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore, serverOrigin } from '../src/auth';

test('server selection never accepts credentials in URLs or non-loopback HTTP', () => {
  expect(serverOrigin('http://127.0.0.1:8788')).toBe('http://127.0.0.1:8788');
  for (const url of ['http://example.com', 'https://user:secret@example.com', 'https://mmddyy.app/mcp', 'https://mmddyy.app?token=x']) expect(() => serverOrigin(url)).toThrow();
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
