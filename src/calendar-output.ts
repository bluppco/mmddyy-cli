type CalendarListItem = {
  name: string;
  id: string;
  group: string;
  role: string;
  visibility: string;
  time_zone: string;
  is_default: boolean | number;
};

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export function formatCalendars(calendars: readonly CalendarListItem[]): string {
  if (!calendars.length) return 'No calendars found.\n';
  return calendars.map(calendar => [
    `${calendar.name}${calendar.is_default === true || calendar.is_default === 1 ? ' (default)' : ''}`,
    `  ID: ${calendar.id}`,
    `  Group: ${calendar.group} · Role: ${capitalize(calendar.role)} · Visibility: ${capitalize(calendar.visibility)}`,
    `  Time zone: ${calendar.time_zone}`,
  ].join('\n')).join('\n\n') + '\n';
}
