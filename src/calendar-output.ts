import { terminal, type OutputOptions } from './terminal';

export function formatCalendars(calendars: readonly Record<string, unknown>[], options?: OutputOptions): string {
  const out = terminal(options);
  if (!calendars.length) return `${out.muted('No calendars found.')}\n`;
  return out.sections(calendars.map(calendar => out.record(
    `${calendar.name ?? 'Calendar'}${calendar.is_default === true || calendar.is_default === 1 ? ' (default)' : ''}`,
    [out.field('ID', calendar.id, true), out.field('Group', calendar.group), out.field('Role', calendar.role),
      out.field('Visibility', calendar.visibility), out.field('Time zone', calendar.time_zone)],
  ))) + '\n';
}
