import type { OperationName } from '../../mcp/src/contracts';
import { formatCalendars } from './calendar-output';
import { terminal, type OutputOptions } from './terminal';

type RecordData = Record<string, unknown>;
const object = (value: unknown): RecordData => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordData : {};
const label = (key: string) => key === 'id' ? 'ID' : key.replaceAll('_', ' ').replace(/\bid\b/g, 'ID').replace(/\burl\b/g, 'URL').replace(/^./, char => char.toUpperCase());
function date(value: unknown): unknown {
  if (typeof value !== 'number') return value;
  const result = new Date(value);
  return Number.isNaN(result.valueOf()) ? value : result.toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

export function formatOutput(value: unknown, operation?: OperationName, options?: OutputOptions): string {
  const out = terminal(options);
  const data = value && typeof value === 'object' && 'data' in value ? value.data : value;
  const field = (key: string, value: unknown) => out.field(label(key), key.endsWith('_at') ? date(value) : typeof value === 'boolean' ? value ? 'Yes' : 'No' : value, key === 'id' || key.endsWith('_id') || key === 'url' || key === 'token');
  const fields = (item: RecordData, keys: string[]) => keys.map(key => field(key, item[key]));
  const workspace = (item: RecordData) => out.record(String(item.name ?? 'Workspace'), fields(item, ['id', 'kind', 'role', 'handle']));
  const profile = (item: RecordData, title: string) => out.record(title, [
    field('handle', item.handle ?? 'Not set'), field('visibility', item.visibility),
    ...(Array.isArray(item.published_calendar_ids) ? item.published_calendar_ids.length
      ? item.published_calendar_ids.map(id => out.field('Published calendar ID', id, true))
      : [out.field('Published calendars', 'None')] : []),
  ]);
  const success: Partial<Record<OperationName, string>> = { delete_event: 'Event deleted.', remove_member: 'Member removed.', revoke_invite: 'Invitation revoked.' };
  if (object(data).ok === true && operation && success[operation]) return `${out.success(success[operation]!)}\n`;
  if (typeof object(data).connected === 'boolean') return `${out.success(object(data).connected ? 'Connected.' : 'Disconnected.')}\n`;
  if (operation === 'list_calendars') return formatCalendars(data as Parameters<typeof formatCalendars>[0], options);
  if (operation === 'list_workspaces') return list(data, 'No workspaces found.', workspace);
  if (operation === 'list_members' || operation === 'update_member') {
    const member = (item: RecordData) => out.record(String(item.name ?? 'Member'), fields(item, ['id', 'user_id', 'role']));
    return operation === 'list_members' ? list(data, 'No members found.', member) : `${member(object(data))}\n`;
  }
  if (operation === 'list_invites' || operation === 'create_invite' || operation === 'preview_invite') {
    const invite = (item: RecordData) => out.record(String(item.calendar_name ?? 'Invitation'), [
      ...fields(item, ['id', 'role', 'expires_at', 'revoked_at', 'url']),
      // New links include the token in the URL; existing links expose only metadata.
      ...(!item.url ? fields(item, ['token']) : []),
    ]);
    return operation === 'list_invites' ? list(data, 'No invitations found.', invite) : `${invite(object(data))}\n`;
  }
  if (operation === 'create_workspace') {
    const item = object(data);
    return `${out.sections([workspace(object(item.workspace)), formatCalendars([object(item.calendar)], options).trimEnd()])}\n`;
  }
  if (operation === 'create_calendar' || operation === 'update_calendar') return formatCalendars([object(data)], options);
  if (operation === 'update_account_profile' || operation === 'update_workspace_profile') return `${profile(object(data), 'Profile updated')}\n`;
  if (operation === 'get_account') {
    const item = object(data);
    return `${out.record(String(item.name ?? 'Account'), fields(item, ['id', 'email']))}\n${profile(item, 'Profile')}\n`;
  }
  if (operation === 'accept_invite') return `${out.success('Invitation accepted.')}\n${field('calendar_id', object(data).calendar_id)}\n`;
  // Event details and future result types use labelled, nested fields instead of JSON.
  const hidden = new Set(['created_by', 'creation_key', 'personal_owner_id', 'bootstrap_key', 'client_key', 'token_hash']);
  function record(item: RecordData, fallback = 'Result'): string {
    const titleKey = typeof item.title === 'string' ? 'title' : typeof item.name === 'string' ? 'name' : undefined;
    return out.record(titleKey ? String(item[titleKey]) : fallback, Object.entries(item).flatMap(([key, value]) => {
      if (hidden.has(key) || key === titleKey || value === null || value === undefined) return [];
      if (Array.isArray(value)) return value.length ? value.map(entry => typeof entry === 'object' ? record(object(entry), label(key)) : field(key, entry)) : [out.field(label(key), 'None')];
      if (typeof value === 'object') return [record(object(value), label(key))];
      return [field(key, value)];
    }));
  }
  function list(items: unknown, empty: string, render: (item: RecordData) => string): string {
    if (!Array.isArray(items) || !items.length) return `${out.muted(empty)}\n`;
    return `${out.sections(items.map(item => render(object(item))))}\n`;
  }
  return Array.isArray(data) ? list(data, 'No results found.', record) : `${data && typeof data === 'object' ? record(object(data)) : out.text(String(data ?? 'Done.'))}\n`;
}
