import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('CLI auth failures use exit 3 and stderr in both JSON and text modes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mmddyy-cli-output-'));
  try {
    for (const json of [true, false]) {
      const child = Bun.spawn([process.execPath, 'src/main.ts', '--server', 'http://127.0.0.1:8788', ...(json ? ['--json'] : []), 'whoami'], {
        env: { ...process.env, MMDDYY_CONFIG_DIR: directory }, stdout: 'pipe', stderr: 'pipe',
      });
      const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(status, stderr).toBe(3);
      expect(stdout).toBe('');
      if (json) expect(JSON.parse(stderr)).toMatchObject({ error: { code: 'unauthorized', status: 401, recovery: { signup_url: 'http://127.0.0.1:8788/signup' } } });
      else { expect(stderr).toContain('Create an account'); expect(stderr).toContain('auth login'); }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
