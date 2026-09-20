import { expect, test } from 'bun:test';
import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';
import { formatOutput } from '../src/output';
import { terminal, terminalOptions } from '../src/terminal';

const id = '35bc7702-3739-4e3d-a97a-2f87c14875ed';
const workspace = { name: 'Personal', id, kind: 'personal', role: 'owner', created_at: 1789825436000, created_by: 'hidden-owner', creation_key: 'hidden-key', personal_owner_id: 'hidden-owner' };
const plain = { color: false, columns: 80 };

test('workspace lists show useful fields and separators only between entries', () => {
  expect(formatOutput({ data: [workspace] }, 'list_workspaces', plain)).toBe(`Personal\n  ID: ${id}\n  Kind: personal\n  Role: owner\n`);
  const multiple = formatOutput({ data: [workspace, { ...workspace, name: 'Engineering' }] }, 'list_workspaces', { columns: 40 });
  expect(multiple.split('\n').filter(line => /^─+$/.test(line))).toEqual(['─'.repeat(40)]);
  expect(multiple).toContain(id);
  expect(multiple).not.toContain('hidden');
  for (const [operation, noun] of [['list_workspaces', 'workspaces'], ['list_calendars', 'calendars'], ['list_members', 'members'], ['list_invites', 'invitations']] as const) {
    expect(formatOutput({ data: [] }, operation, plain)).toBe(`No ${noun} found.\n`);
  }
});

test('styles require a terminal, respect NO_COLOR and TERM, and do not change text', () => {
  expect(terminalOptions({ isTTY: true, columns: 24 }, {})).toEqual({ color: true, columns: 24 });
  expect(terminalOptions({ isTTY: false, columns: 24 }, { FORCE_COLOR: '1' }).color).toBe(false);
  expect(terminalOptions({ isTTY: true }, { NO_COLOR: '' }).color).toBe(false);
  expect(terminalOptions({ isTTY: true }, { TERM: 'dumb' }).color).toBe(false);
  const colored = formatOutput({ data: [workspace] }, 'list_workspaces', { ...plain, color: true });
  expect(colored).toContain('\x1b[1mPersonal');
  expect(colored).toContain(`\x1b[36m${id}`);
  expect(stripVTControlCharacters(colored)).toBe(formatOutput({ data: [workspace] }, 'list_workspaces', plain));
});

test('prose wraps by display width without losing graphemes; identifiers and URLs remain copyable', () => {
  for (const columns of [12, 24, 40, 80, 140]) {
    const out = terminal({ columns });
    const text = out.title('Planning 日本語 👩🏽‍💻 e\u0301 ' + 'longword'.repeat(20));
    expect(text.split('\n').every(line => stringWidth(line) <= columns)).toBe(true);
    expect(text).toContain('👩🏽‍💻');
    expect(text).toContain('e\u0301');
    const url = `https://example.com/join#token=${'a'.repeat(64)}`;
    expect(out.field('ID', id, true)).toContain(id);
    expect(out.field('URL', url, true)).toContain(url);
    expect(out.error(`Open ${url} to sign in`)).toContain(url);
    const details = out.field('Description', 'A long description with several words and\na second paragraph for wrapping.');
    expect(details.split('\n').every(line => stringWidth(line) <= columns)).toBe(true);
    expect(out.sections(['one', 'two']).split('\n')[1].length).toBe(Math.min(48, columns));
  }
  expect(terminal({ columns: 0 }).text('Hello')).toBe('Hello');
  expect(terminal({ color: false }).title('Unsafe\x1b[31m title\x07')).toBe('Unsafe title');
});

test('other operations show readable dates, results and full sharing links', () => {
  const expires = Date.UTC(2026, 8, 26, 12, 0);
  const invite = formatOutput({ data: [{ id, role: 'viewer', expires_at: expires, revoked_at: null }] }, 'list_invites', plain);
  expect(invite).toContain('Expires at: 2026-09-26 12:00:00 UTC');
  expect(invite).not.toContain(String(expires));
  expect(formatOutput({ data: { ok: true } }, 'delete_event', plain)).toBe('Event deleted.\n');
  expect(formatOutput({ data: { connected: false } }, undefined, plain)).toBe('Disconnected.\n');
  expect(formatOutput({ data: [{ id, name: 'Sam', role: 'editor' }] }, 'list_members', plain)).toContain(`Sam\n  ID: ${id}\n  Role: editor`);
  const url = `https://example.com/join#token=${'a'.repeat(64)}`;
  const created = formatOutput({ data: { id, token: 'a'.repeat(64), url, expires_at: expires } }, 'create_invite', { columns: 24 });
  expect(created).toContain(url);
  expect(created.match(/a{64}/g)).toHaveLength(1);
  const profile = formatOutput({ data: { handle: 'studio', visibility: 'public', published_calendar_ids: [id] } }, 'update_workspace_profile', plain);
  expect(profile).toContain('Profile updated');
  expect(profile).toContain(`Published calendar ID: ${id}`);
  const createdWorkspace = formatOutput({ data: { workspace, calendar: { id: 'calendar', name: 'Team calendar', time_zone: 'UTC' } } }, 'create_workspace', plain);
  expect(createdWorkspace).toContain('Team calendar');
  expect(createdWorkspace).not.toContain('undefined');
  const event = formatOutput({ data: { id, title: 'Review', notes: 'First line\nSecond line', start_at: expires, all_day: false, client_key: 'hidden' } }, 'get_event', plain);
  expect(event).toContain('2026-09-26 12:00:00 UTC');
  expect(event).toContain('Second line');
  expect(event).not.toContain('hidden');
});

test('CLI routes lists, details and confirmations while preserving full JSON and disabling pipe colors', async () => {
  for (const [args, data] of [
    [['workspaces', 'list'], [workspace]],
    [['members', 'list', '--calendar', 'calendar'], [{ id, name: 'Sam', role: 'editor' }]],
    [['whoami'], { id, name: 'Sam', email: 'sam@example.com' }],
    [['events', 'delete', '--calendar', 'calendar', '--event', id], { ok: true }],
  ] as const) {
    for (const json of [false, true]) {
      const script = `import { mock } from 'bun:test';
        mock.module(process.cwd() + '/src/client.ts', () => ({ connect: async () => {}, call: async () => ({ data: ${JSON.stringify(data)} }) }));
        process.execArgv = [];
        process.argv = [process.execPath, 'src/main.ts', ...${JSON.stringify([...args, ...(json ? ['--json'] : [])])}];
        await import(process.cwd() + '/src/main.ts');`;
      const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '1' };
      delete env.NO_COLOR;
      const child = Bun.spawn([process.execPath, '--eval', script], { stdout: 'pipe', stderr: 'pipe', env });
      const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(status, stderr).toBe(0);
      expect(stderr).toBe('');
      expect(stdout).not.toContain('\x1b[');
      expect(stdout).not.toContain('┌');
      if (json) expect(JSON.parse(stdout)).toEqual({ data });
      else expect(stdout).not.toContain('"data"');
    }
  }
});
