import { operations, type OperationName } from '../../mcp/src/contracts';
import type { CalendarData, CalendarSummary } from '../../astro/src/lib/types';
import type { Events } from '../../astro/src/lib/loomup.generated';
import { CliError } from './auth';
import { terminal, type OutputOptions } from './terminal';

type Request = (name: OperationName, input: Record<string, unknown>) => Promise<unknown>;
type EventGroup = { calendar: CalendarSummary; events: CalendarData['events']; occurrences: CalendarData['occurrences'] };
export type EventList = { groups: EventGroup[]; range?: { from: string; to: string }; timeZone?: string; json: unknown };

export async function listEvents(value: unknown, request: Request, now = new Date()): Promise<EventList> {
  const input = operations.list_events.schema.partial().parse(value);
  if ((input.from === undefined) !== (input.to === undefined)) throw new CliError('Supply both --from and --to, or omit both to list all saved events.', 'invalid_input', 400);
  const range = input.from !== undefined && input.to !== undefined ? { from: input.from, to: input.to } : undefined;
  if (range) {
    const from = Date.parse(range.from), to = Date.parse(range.to);
    const hasOffset = (value: string) => /T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
    if (!hasOffset(range.from) || !hasOffset(range.to) || !Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 94 * 86400000) {
      throw new CliError('Use ISO datetimes with offsets and an increasing range of at most 93 days.', 'invalid_input', 400);
    }
  }
  if (input.time_zone) {
    try { new Intl.DateTimeFormat('en', { timeZone: input.time_zone }); }
    catch { throw new CliError('Choose a valid timezone.', 'invalid_input', 400); }
  }
  const { data: calendars } = await request('list_calendars', {}) as { data: CalendarSummary[] };
  let selected = calendars;
  if (input.calendar_id !== undefined) {
    const idMatch = calendars.find(calendar => calendar.id === input.calendar_id);
    selected = idMatch ? [idMatch] : calendars.filter(calendar => calendar.name.toLowerCase() === input.calendar_id!.toLowerCase());
    if (!selected.length) throw new CliError(`Calendar "${input.calendar_id}" not found. Run md calendars list to see your calendars.`, 'invalid_input', 400);
    if (selected.length > 1) throw new CliError(`More than one calendar is named "${input.calendar_id}". Omit --calendar to show them all, or use an ID from md calendars list.`, 'invalid_input', 400);
  }
  // The existing API always returns every stored series in `events`; the
  // required bounded range only controls its additional `occurrences` array.
  const queryRange = range ?? { from: now.toISOString(), to: new Date(now.getTime() + 86400000).toISOString() };
  const groups: EventGroup[] = [];
  let singleResult: unknown;
  for (const calendar of selected) {
    let result: unknown;
    try {
      result = await request('list_events', operations.list_events.schema.parse({ calendar_id: calendar.id, ...queryRange, time_zone: input.time_zone ?? calendar.time_zone }));
    } catch (error) {
      if (error instanceof CliError) throw new CliError(`${calendar.name}: ${error.message}`, error.code, error.status, error.recovery);
      throw error;
    }
    const { data } = result as { data: CalendarData };
    groups.push({ calendar, events: data.events, occurrences: range ? data.occurrences : [] });
    singleResult = result;
  }
  // Preserve the established JSON response for explicit calendar/range calls.
  const json = input.calendar_id !== undefined && range ? singleResult : {
    data: { calendars: groups.map(({ calendar, events, occurrences }) => ({ calendar, events, ...(range ? { occurrences } : {}) })), ...(range ?? {}) },
  };
  return { groups, range, timeZone: input.time_zone, json };
}

function localTime(value: string | number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

function when(start: string | number, end: string | number, allDay: boolean, zone: string): { sort: string; label: string } {
  if (allDay) {
    const first = String(start), last = new Date(Date.parse(`${end}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    return { sort: first, label: `${first}${last === first ? '' : `–${last}`} · All day` };
  }
  const first = localTime(start, zone), last = localTime(end, zone);
  return { sort: first, label: `${first}–${first.slice(0, 10) === last.slice(0, 10) ? last.slice(11) : last}` };
}

export function formatEventList(list: EventList, options?: OutputOptions): string {
  const out = terminal(options);
  if (!list.groups.length) return `${out.muted('No calendars found.')}\n`;
  const heading = list.range ? `Events from ${list.range.from} to ${list.range.to} (end exclusive)` : 'All saved events · Repeating events shown once';
  const sections = list.groups.map(({ calendar, events, occurrences }) => {
    const zone = list.timeZone ?? calendar.time_zone;
    const row = (event: Events | undefined, title: string, start: string | number, end: string | number, allDay: boolean, repeating: boolean) => {
      const time = when(start, end, allDay, zone);
      const recurrence = repeating && event && event.recurrence !== 'none' ? `Repeats ${event.recurrence}${event.repeat_until ? ` until ${event.repeat_until}` : ''}` : '';
      return { sort: time.sort, text: [out.title(title, 2), out.text(time.label, 4),
        event?.location ? out.text(`Location: ${event.location}`, 4) : '',
        event?.notes?.trim() ? out.text(`Notes: ${event.notes}`, 4) : '', recurrence ? out.muted(recurrence, 4) : '',
        out.field('ID', event?.id, true),
      ].filter(Boolean).join('\n') };
    };
    const byId = new Map(events.map(event => [event.id, event]));
    const rows = list.range
      ? occurrences.map(item => row(byId.get(item.extendedProps.seriesId), item.title, item.start, item.end, item.allDay, false))
      : events.map(event => row(event, event.title, event.all_day ? event.start_date! : event.start_at!, event.all_day ? event.end_date! : event.end_at!, Boolean(event.all_day), true));
    rows.sort((a, b) => a.sort.localeCompare(b.sort));
    return `${out.title(calendar.name)}\n${out.field('Group', calendar.group)}\n${out.field('Time zone', zone)}\n\n${rows.length ? rows.map(item => item.text).join('\n\n') : out.muted(`No events${list.range ? ' in this range' : ''}.`, 2)}`;
  });
  return `${out.muted(heading)}\n\n${out.sections(sections)}\n`;
}
