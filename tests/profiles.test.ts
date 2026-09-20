import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('profile commands accept calendar lists and private empty selections before requiring auth', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mmddyy-profile-cli-'));
  try {
    for (const args of [
      ['account', 'profile', '--handle', 'mohit'],
      ['account', 'profile', '--visibility', 'public', '--published-calendar-ids', 'cal-one,cal-two'],
      ['workspaces', 'profile', '--workspace', 'org', '--visibility', 'private', '--published-calendar-ids', ''],
      ['workspaces', 'create', '--name', 'Studio', '--handle', 'studio', '--time-zone', 'UTC'],
    ]) {
      const child = Bun.spawn([process.execPath, 'src/main.ts', '--json', ...args], { env: { ...process.env, MMDDYY_CONFIG_DIR: directory }, stdout: 'pipe', stderr: 'pipe' });
      const [status, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect(status, stderr).toBe(3);
      expect(JSON.parse(stderr)).toMatchObject({ error: { code: 'unauthorized' } });
    }
    const child = Bun.spawn([process.execPath, 'src/main.ts', '--json', 'workspaces', 'create', '--name', 'Studio', '--time-zone', 'UTC'], { env: { ...process.env, MMDDYY_CONFIG_DIR: directory }, stdout: 'pipe', stderr: 'pipe' });
    expect(await child.exited).toBe(2);
    expect(await new Response(child.stderr).text()).toContain('handle');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
