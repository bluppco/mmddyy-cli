import { expect, test } from 'bun:test';
import stringWidth from 'string-width';
import { listEvents, formatEventList } from '../src/event-list';
import { CliError } from '../src/auth';
import type { CalendarSummary } from '../../astro/src/lib/types';
import type { Events } from '../../astro/src/lib/loomup.generated';
import type { OperationName } from '../../mcp/src/contracts';

const personal: CalendarSummary = { id: 'personal', workspace_id: 'workspace', name: 'My calendar', group: 'Personal', role: 'owner', time_zone: 'Asia/Kolkata', color: '#7655dd', visibility: 'private', audience: 'restricted', is_default: true, bootstrap_key: null, created_by: 'user', created_at: 0 };
const work = { ...personal, id: 'work', name: 'Work', group: 'Team', time_zone: 'UTC' };
const event = (overrides: Partial<Events> = {}): Events => ({ id: 'event', calendar_id: personal.id, workspace_id: 'workspace', title: 'Design review', notes: '', location: '', all_day: false, start_at: Date.parse('2026-09-19T04:30Z'), end_at: Date.parse('2026-09-19T05:30Z'), start_date: null, end_date: null, recurrence: 'none', repeat_until: null, time_zone: 'Asia/Kolkata', created_by: 'user', created_at: 0, updated_at: 0, client_key: null, ...overrides });
const range = { from: '2026-09-19T00:00:00Z', to: '2026-09-26T00:00:00Z' };

test('long event titles, locations and headings wrap on narrow terminals', () => {
  const calendar = { ...personal, name: 'A shared calendar with a long descriptive name' };
  const item = event({ title: 'Design review with the international engineering team', location: 'Meeting room 日本語 👩🏽‍💻 with a long location name', recurrence: 'weekly', repeat_until: '2026-12-31' });
  for (const columns of [24, 40, 80, 120]) {
    const text = formatEventList({ groups: [{ calendar, events: [item], occurrences: [] }], json: {} }, { columns, color: true });
    expect(text.split('\n').every(line => stringWidth(line) <= columns)).toBe(true);
    expect(text).toContain(item.id);
    expect(text).toContain('👩🏽‍💻');
  }
});

function fixture(calendars = [personal, work], events = [event()]) {
  const calls: { name: OperationName; input: Record<string, unknown> }[] = [];
  const request = async (name: OperationName, input: Record<string, unknown>) => {
    calls.push({ name, input });
    if (name === 'list_calendars') return { data: calendars };
    return { data: { events: events.filter(event => event.calendar_id === input.calendar_id), occurrences: [] } };
  };
  return { request, calls };
}

test('bare list includes past and future series from every calendar without filtering by the API occurrence window', async () => {
  const past = event({ id: 'past', start_at: Date.parse('2020-01-01T00:00Z'), end_at: Date.parse('2020-01-01T01:00Z') });
  const future = event({ id: 'future', calendar_id: work.id, start_at: Date.parse('2030-01-01T00:00Z'), end_at: Date.parse('2030-01-01T01:00Z'), recurrence: 'weekly' });
  const { request, calls } = fixture([personal, work], [past, future]);
  const result = await listEvents({}, request, new Date('2026-09-19T00:00Z'));
  expect(calls.map(call => call.name)).toEqual(['list_calendars', 'list_events', 'list_events']);
  expect(calls.slice(1).map(call => call.input.calendar_id)).toEqual(['personal', 'work']);
  expect(result.groups.map(group => group.events.map(event => event.id))).toEqual([['past'], ['future']]);
  expect(result.json).toEqual({ data: { calendars: [{ calendar: personal, events: [past] }, { calendar: work, events: [future] }] } });
  const output = formatEventList(result);
  expect(output).toContain('2020-01-01');
  expect(output).toContain('2030-01-01');
  expect(output).toContain('Repeats weekly');
});

test('name and ID filters resolve before event requests; ambiguity never silently selects a calendar', async () => {
  for (const calendar_id of ['my CALENDAR', 'personal']) {
    const { request, calls } = fixture();
    expect((await listEvents({ calendar_id }, request)).groups).toHaveLength(1);
    expect(calls[1].input.calendar_id).toBe('personal');
  }
  const duplicate = fixture([personal, { ...work, name: personal.name }]);
  await expect(listEvents({ calendar_id: personal.name }, duplicate.request)).rejects.toThrow('More than one calendar');
  expect(duplicate.calls).toHaveLength(1);
  expect((await listEvents({}, duplicate.request)).groups).toHaveLength(2);
  await expect(listEvents({ calendar_id: 'missing' }, fixture().request)).rejects.toThrow('not found');
});

test('invalid and incomplete ranges fail before making requests', async () => {
  for (const input of [{ from: range.from }, { to: range.to }, { from: range.to, to: range.from }, { from: '2026-09-19', to: '2026-09-26' }, { from: range.from, to: '2027-09-19T00:00:00Z' }, { time_zone: 'not/a-zone' }]) {
    const { request, calls } = fixture();
    await expect(listEvents(input, request)).rejects.toMatchObject({ code: 'invalid_input', status: 400 });
    expect(calls).toHaveLength(0);
  }
});

test('ranged list prints occurrences instead of the original series and preserves explicit-calendar JSON', async () => {
  const series = event({ start_at: Date.parse('2020-01-01T00:00Z'), recurrence: 'daily' });
  const data = { events: [series], occurrences: [{ id: 'event@1', title: 'Design review', start: '2026-09-20T04:30:00Z', end: '2026-09-20T05:30:00Z', allDay: false, extendedProps: { seriesId: series.id } }] };
  const request = async (name: OperationName) => name === 'list_calendars' ? { data: [personal] } : { data };
  const result = await listEvents({ ...range, calendar_id: personal.id }, request);
  expect(result.json).toEqual({ data });
  const text = formatEventList(result);
  expect(text).toContain('2026-09-20 10:00–11:00');
  expect(text).not.toContain('2020-01-01');
  expect(text).not.toContain('Repeats daily');
  expect((await listEvents(range, request)).json).toEqual({ data: { calendars: [{ calendar: personal, ...data }], ...range } });
});

test('formatting sorts by local date, labels zones and handles all-day exclusive end dates', async () => {
  const rows = [event(), event({ id: 'holiday', title: 'Holiday', all_day: true, start_date: '2026-09-19', end_date: '2026-09-20' }), event({ id: 'trip', title: 'Trip', all_day: true, start_date: '2026-09-20', end_date: '2026-09-23' })];
  const result = await listEvents({}, fixture([personal, work], rows).request);
  const text = formatEventList(result);
  expect(text).toContain('My calendar');
  expect(text).toContain('Personal');
  expect(text).toContain('Asia/Kolkata');
  expect(text).toContain('2026-09-19 10:00–11:00');
  expect(text).toContain('2026-09-19 · All day');
  expect(text).toContain('2026-09-20–2026-09-22 · All day');
  expect(text.indexOf('Holiday')).toBeLessThan(text.indexOf('Design review'));
  expect(text).toMatch(/Work[\s\S]*Team[\s\S]*UTC[\s\S]*No events\./);
  const utc = formatEventList(await listEvents({ time_zone: 'UTC' }, fixture([personal], rows).request));
  expect(utc).toContain('2026-09-19 04:30–05:30');
});

test('empty accounts and empty ranges have explicit output', async () => {
  const empty = fixture([]);
  expect(formatEventList(await listEvents({}, empty.request))).toBe('No calendars found.\n');
  expect(empty.calls).toHaveLength(1);
  expect(formatEventList(await listEvents(range, fixture([personal], []).request))).toContain('No events in this range.');
});

test('a failed calendar aborts the result and preserves auth recovery', async () => {
  const recovery = { signup_url: 'https://mcp.mmddyy.app/signup', login_command: 'md auth login' };
  const request = async (name: OperationName, input: Record<string, unknown>) => {
    if (name === 'list_calendars') return { data: [personal, work] };
    if (input.calendar_id === work.id) throw new CliError('Reconnect.', 'unauthorized', 401, recovery);
    return { data: { events: [event()], occurrences: [] } };
  };
  await expect(listEvents({}, request)).rejects.toMatchObject({ message: 'Work: Reconnect.', code: 'unauthorized', status: 401, recovery });
});

test('CLI bare events list routes through the grouped formatter in text and JSON modes', async () => {
  for (const json of [false, true]) {
    const script = `import { mock } from 'bun:test';
      mock.module(process.cwd() + '/src/client.ts', () => ({ connect: async () => {}, call: async (_store, name) => name === 'list_calendars' ? { data: ${JSON.stringify([personal, work])} } : { data: { events: [], occurrences: [] } } }));
      process.execArgv = [];
      process.argv = [process.execPath, 'src/main.ts', ...${JSON.stringify(json ? ['--json', 'events', 'list'] : ['events', 'list'])}];
      await import(process.cwd() + '/src/main.ts');`;
    const child = Bun.spawn([process.execPath, '--eval', script], { stdout: 'pipe', stderr: 'pipe' });
    const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(status, stderr).toBe(0);
    expect(stderr).toBe('');
    if (json) expect(JSON.parse(stdout).data.calendars.map((group: { calendar: { id: string } }) => group.calendar.id)).toEqual(['personal', 'work']);
    else { expect(stdout).toMatch(/My calendar[\s\S]*Personal[\s\S]*Work[\s\S]*Team/); expect(stdout).not.toContain('calendar_id'); }
  }
});
