import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('bare commands and explicit help print usage successfully', async () => {
  for (const args of [[], ['auth'], ['calendars'], ['events'], ['--help'], ['auth', '--help'], ['help', 'events']]) {
    const child = Bun.spawn([process.execPath, 'src/main.ts', ...args], { stdout: 'pipe', stderr: 'pipe' });
    const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(status, `${args.join(' ')}: ${stderr}`).toBe(0);
    expect(stdout).toContain('Usage: mmddyy');
    expect(stdout).toContain('Commands:');
    expect(stderr).toBe('');
    expect(stdout).not.toContain('(outputHelp)');
  }
});

test('invalid commands still fail with stderr in text and JSON modes', async () => {
  for (const json of [false, true]) {
    const child = Bun.spawn([process.execPath, 'src/main.ts', ...(json ? ['--json'] : []), 'not-a-command'], { stdout: 'pipe', stderr: 'pipe' });
    const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(status).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).not.toContain('(outputHelp)');
    if (json) expect(JSON.parse(stderr)).toMatchObject({ error: { code: 'invalid_input', status: 400 } });
    else expect(stderr).toContain('error:');
  }
});

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
