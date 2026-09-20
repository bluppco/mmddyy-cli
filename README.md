# mmddyy CLI

Calendars, events, teams, and sharing from your terminal or an MCP client.
Requires Node.js 22.12 or newer.

```sh
npm install -g @mmddyy/cli
md auth login
md calendars list
md events list
```

`auth login` opens mmddyy in your browser. Sign in and choose read, write, sharing,
and/or profile access. Profile access allows publishing selected calendars. Each connection has its own session; existing calendar roles still
apply. `--no-browser` prints the URL instead. The browser callback must reach the
CLI's loopback listener on the same machine.

New here? Choose **Create an account** on the connection page. After website
signup, you return to permission approval without entering your password again.
The connection expires after ten minutes; if it expires after signup, run
`md auth login` again and sign in with the account you just created.
Ordinary commands do not launch a browser or retry calendar operations after login.

```sh
md events create --calendar CALENDAR_ID --title 'Design review' \
  --start 2026-09-18T10:00 --end 2026-09-18T11:00 \
  --time-zone Asia/Kolkata --recurrence weekly
md events update --calendar CALENDAR_ID --event EVENT_ID --title 'Weekly review'
md invites create --calendar CALENDAR_ID --role viewer
md auth status
md auth logout
```

Use `--help` on any command to see its options. Command groups are `workspaces`,
`calendars`, `events`, `members`, and `invites`. `whoami` displays your account.
Workspaces support list/create; calendars support list/create/update. The remaining
commands mirror the application's event and sharing workflows.

`calendars list` prints every accessible calendar in server order, without a
selection prompt. Each entry includes its name, full copyable ID, group, role,
visibility, and time zone; default calendars are marked `(default)`:

```text
My calendar (default)
  ID: 6c21043b-e986-472b-ac91-6a8ec8d504af
  Group: Personal
  Role: owner
  Visibility: private
  Time zone: Asia/Calcutta
```

Entries are separated by a dim rule, capped at 48 columns and shortened to fit the
terminal. A single entry needs no separator. An empty list prints `No calendars found.`
Use `md --json calendars list` for the complete data, including internal fields.

Workspace, member, and invitation lists use the same stacked layout. For example,
`md workspaces list` prints:

```text
Personal
  ID: 35bc7702-3739-4e3d-a97a-2f87c14875ed
  Kind: personal
  Role: owner
```

Names are bold, labels and separators are dim, and IDs and links are cyan. Colors
are disabled for pipes, `TERM=dumb`, or when `NO_COLOR` is set. Prose wraps to the
terminal width (80 columns when unavailable), including Unicode text. IDs and URLs
are never truncated or split; exceptionally narrow terminals may wrap them visually.
Account/profile and event details use labelled fields, and successful deletions,
revocations, and connection changes print short confirmations. Numeric timestamps
in details and invitations are shown as readable UTC dates. `--json` always returns
the original complete response without colors or layout changes.

`events list` shows every saved event across all accessible calendars, grouped by
calendar and sorted by start date within each group. This includes past and future
events; repeating events appear once with their repeat rule. Dates and times use
each calendar's time zone, or `--time-zone` if supplied. Empty calendars are shown
with `No events.` Each event shows its title, time, optional location, notes and
recurrence, and stored series ID on separate lines. Multiline notes retain their
line breaks and wrap to the terminal width. Calendar groups have separators between them.

```sh
md events list
md events list --calendar "My calendar"
md events list --from 2026-09-19T00:00:00+05:30 --to 2026-09-26T00:00:00+05:30
```

`--calendar` accepts a name (case-insensitive) or full ID; omitting it lists every
calendar automatically. Duplicate names require an ID only when filtering to one
calendar. Supply both `--from` and `--to` to show occurrences in that range,
including each recurrence, instead of all saved events. Range ends are exclusive.

Dates and updates:

- Timed inputs are local ISO datetimes. Timezone defaults to the calendar timezone.
- All-day events use `--all-day` and date-only inputs. The end date is exclusive:
  September 18 alone means `--start 2026-09-18 --end 2026-09-19`.
- `--timed` changes an existing all-day event to a timed event; supply matching times.
- Recurrence is `none`, `daily`, or `weekly`. `--repeat-until` is inclusive.
- Updates preserve omitted fields. Recurring edits and deletion affect the entire
  series, including past occurrences. Use a stored event ID, not an occurrence ID.
- View ranges are bounded by the calendar service. All upstream pages are followed.
- A create accepts `--request-id` for safe repetition of the same request. Supply
  your own stable ID when retrying after an uncertain result. Sharing-link creation
  has no idempotency guarantee and is never retried automatically.

## Scripts

`--json` writes a single `{ "data": ... }` object to stdout. Errors go to stderr
as `{ "error": { "code", "message", "status" } }`. Exit codes: 0 success,
1 operation/network failure, 2 invalid input, 3 sign-in required.

For `events list`, JSON without a calendar filter returns
`{ "data": { "calendars": [{ "calendar": { ... }, "events": [...] }] } }`.
A date range adds `from` and `to` to `data` and `occurrences` to each calendar
entry. With both `--calendar` and a date range, the existing
`{ "data": { "events": [...], "occurrences": [...] } }` response is preserved.
Without dates, a calendar filter uses the grouped response with one calendar.

Authentication errors also include `error.recovery` with `signup_url` and
`login_command`. These use your selected server. Permission denials and service
outages remain ordinary errors, without signup guidance.

`--input event.json` or `--input -` reads a JSON object using snake_case tool field
names. Explicit flags override file fields.

```sh
md --json events create --input event.json
md --server http://127.0.0.1:8788 auth login
```

`MMDDYY_SERVER` sets the default origin. `MMDDYY_CONFIG_DIR` overrides credential
storage. The default is `$XDG_CONFIG_HOME/mmddyy`, `~/.config/mmddyy`, or
`%APPDATA%/mmddyy` on Windows. Credentials are separated by server origin; on Unix,
directories are 0700 and files 0600. Refreshes use a cross-process lock and atomic
file replacement. Treat the directory as a secret; do not commit or share it.

## MCP

Remote clients connect to `https://mcp.mmddyy.app/mcp` and authorize in the browser.
For local stdio clients, sign in once with the CLI, then configure:

```json
{
  "mcpServers": {
    "mmddyy": { "command": "md", "args": ["mcp"] }
  }
}
```

Alternatively use `"command": "npx", "args": ["-y", "@mmddyy/cli", "mcp"]`.
The stdio server exposes the bundled tool definitions and forwards calls to the
hosted service. It starts even without credentials and returns signup/login
instructions as tool errors. Run `md auth login` in a terminal, then retry the
tool; the running server picks up the new credentials without a restart. It never
opens a browser automatically. Diagnostics use stderr only.
Disconnect apps at `https://mmddyy.app/connected-apps`. If renewal was interrupted,
run `auth login` again rather than retrying an expired connection indefinitely.

## Development

These private repositories must be checked out with the following sibling names:

```sh
git clone https://github.com/bluppco/mmddyy.app.git astro
git clone https://github.com/bluppco/mmddyy-mcp.git mcp
git clone https://github.com/bluppco/mmddyy-cli.git cli
```

Run `bun install --frozen-lockfile` in each directory before building.

Keep `cli/`, `mcp/`, and `astro/` as sibling directories. The build bundles shared
operation contracts from `../mcp/src/contracts.ts`; the published package has no
dependency on either sibling directory or on Bun at runtime.

```sh
bun install --frozen-lockfile
bun run check
bun run test
bun run build
npm pack
```

Use `node dist/main.js` during development. Deploy and verify the matching MCP
server before publishing a CLI release. Run resource-intensive checks serially.

## Handles and public profiles

Reconnect with `md auth login` to grant the new `profile` permission before changing existing handles or publishing calendars. Organization creation requires `--handle`.

```sh
md workspaces create --name Studio --handle studio-example --time-zone UTC
md account profile --handle mohit-example
md account profile --visibility public --published-calendar-ids calendar-id
md workspaces profile --workspace workspace-id --visibility public --published-calendar-ids calendar-one,calendar-two
md account profile --visibility private --published-calendar-ids ''
```

Visibility and selected calendar IDs must be sent together; JSON `--input` accepts `published_calendar_ids` as an array. Private is the default. Public HTML and Markdown live at `/@handle` and `/@handle.md` and expose only ongoing/upcoming titles and times. Renaming releases the old handle immediately. Shared-in calendars cannot be published.
