#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { commandTools, operations, type OperationName } from '../../mcp/src/contracts';
import { version } from './version';
import { AuthStore, CliError, cliFailure, login, serverOrigin } from './auth';
import { call } from './client';
import { serveStdio } from './mcp';
import { formatOutput } from './output';
import { terminal, terminalOptions } from './terminal';
import { listEvents, formatEventList } from './event-list';

const program = new Command().name('md').version(version).description('Your calendars, events and sharing from the terminal.').option('--server <origin>', 'Server origin', process.env.MMDDYY_SERVER ?? 'https://mcp.mmddyy.app').option('--json', 'Machine-readable JSON output').configureOutput({ writeErr: () => {} }).exitOverride();
const store = () => new AuthStore(serverOrigin(program.opts().server));
function output(value: unknown, operation?: OperationName) {
  if (program.opts().json) { process.stdout.write(`${JSON.stringify(value)}\n`); return; }
  process.stdout.write(formatOutput(value, operation));
}
const auth = program.command('auth').description('Manage your browser-authorized connection.');
auth.command('login').option('--no-browser', 'Print the sign-in URL without opening it').action(async options => { await login(store(), options.browser === false); output({ data: { connected: true } }); });
auth.command('logout').action(async () => { await store().logout(); output({ data: { connected: false } }); });
auth.command('status').action(async () => output(await call(store(), 'get_account', {})));
program.command('mcp').description('Serve calendar tools over stdio; use auth login when prompted.').action(async () => { await serveStdio(store()); });
const groups = new Map<string, Command>();
const flagFor = (field: string) => ({ calendar_id: 'calendar', workspace_id: 'workspace', event_id: 'event', member_id: 'member', invite_id: 'invite' } as Record<string, string>)[field] ?? field.replaceAll('_', '-');
const camel = (flag: string) => flag.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
for (const [path, name] of Object.entries(commandTools) as [string, OperationName][]) {
  const parts = path.split(' ');
  let parent = program;
  if (parts.length === 2) {
    if (!groups.has(parts[0])) groups.set(parts[0], program.command(parts[0]));
    parent = groups.get(parts[0])!;
  }
  const op = operations[name];
  const command = parent.command(parts.at(-1)!).description(op.description).option('--input <file>', 'Read a JSON object from a file, or - for stdin');
  if (name === 'list_events') command.description('List all saved events grouped by calendar. Optionally filter by calendar or date range.');
  for (const [field, schema] of Object.entries(op.schema.shape)) {
    const flag = flagFor(field);
    const description = name === 'list_events' && field === 'calendar_id' ? 'Calendar name or ID. Defaults to all accessible calendars.'
      : name === 'list_events' && field === 'from' ? 'Range start: ISO datetime with offset. Supply with --to; otherwise list all saved events.'
      : name === 'list_events' && field === 'to' ? 'Exclusive range end: ISO datetime with offset. Supply with --from.'
      : schema.description ?? field.replaceAll('_', ' ');
    command.option(field === 'all_day' ? '--all-day' : `--${flag} <value>`, description);
  }
  if ('all_day' in op.schema.shape) command.option('--timed', 'Set all_day to false');
  command.action(async options => {
    let input: Record<string, unknown> = {};
    if (options.input) {
      let raw: string;
      if (options.input === '-') {
        raw = '';
        for await (const chunk of process.stdin) {
          raw += chunk.toString();
          if (raw.length > 32768) throw new CliError('Input exceeds 32 KiB.', 'invalid_input', 400);
        }
      } else raw = await readFile(options.input, 'utf8');
      let value: unknown;
      try { value = JSON.parse(raw); } catch { throw new CliError('Input must be valid JSON.', 'invalid_input', 400); }
      input = z.record(z.string(), z.unknown()).parse(value);
    }
    for (const field of Object.keys(op.schema.shape)) {
      const value = options[camel(flagFor(field))];
      if (value !== undefined) input[field] = field === 'published_calendar_ids' ? String(value).split(',').map(id => id.trim()).filter(Boolean) : value;
    }
    if (options.timed) {
      if (options.allDay) throw new CliError('Choose --all-day or --timed.', 'invalid_input', 400);
      input.all_day = false;
    }
    if (name === 'list_events') {
      const result = await listEvents(input, (operation, args) => call(store(), operation, args));
      if (program.opts().json) output(result.json);
      else process.stdout.write(formatEventList(result));
      return;
    }
    if ('request_id' in op.schema.shape) input.request_id ??= crypto.randomUUID();
    input = op.schema.parse(input);
    output(await call(store(), name, input), name);
  });
}
// Bare commands are requests for help, including command groups such as `auth`.
for (const command of [program, auth, ...groups.values()]) {
  command.addHelpCommand().action(() => { command.help(); });
}
try { await program.parseAsync(); }
catch (error) {
  if (error instanceof CommanderError && error.exitCode === 0) process.exitCode = 0;
  else {
    const failure = error instanceof CliError ? error : error instanceof z.ZodError ? new CliError(error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '), 'invalid_input', 400) : error instanceof CommanderError ? new CliError(error.message, 'invalid_input', 400) : new CliError(error instanceof Error ? error.message : 'Request failed.');
    const result = cliFailure(failure, program.opts().server);
    process.stderr.write(program.opts().json ? `${JSON.stringify({ error: { code: result.code, message: result.message, status: result.status, ...(result.recovery ? { recovery: result.recovery } : {}) } })}\n` : `${terminal(terminalOptions(process.stderr)).error(result.message)}\n`);
    process.exitCode = failure.status === 401 || failure.code === 'invalid_grant' ? 3 : failure.status === 400 ? 2 : 1;
  }
}
