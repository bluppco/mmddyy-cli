# mmddyy CLI

Calendars, events, teams, and sharing from your terminal or an MCP client.
Requires Node.js 22.12 or newer.

```sh
npm install -g @mmddyy/cli
mmddyy auth login
mmddyy calendars list
mmddyy events list --calendar CALENDAR_ID \
  --from 2026-09-18T00:00:00Z --to 2026-09-25T00:00:00Z
```

`auth login` opens mmddyy in your browser. Sign in and choose read, write, and/or
sharing access. Each connection has its own session; existing calendar roles still
apply. `--no-browser` prints the URL instead. The browser callback must reach the
CLI's loopback listener on the same machine.

```sh
mmddyy events create --calendar CALENDAR_ID --title 'Design review' \
  --start 2026-09-18T10:00 --end 2026-09-18T11:00 \
  --time-zone Asia/Kolkata --recurrence weekly
mmddyy events update --calendar CALENDAR_ID --event EVENT_ID --title 'Weekly review'
mmddyy invites create --calendar CALENDAR_ID --role viewer
mmddyy auth status
mmddyy auth logout
```

Use `--help` on any command to see its options. Command groups are `workspaces`,
`calendars`, `events`, `members`, and `invites`. `whoami` displays your account.
Workspaces support list/create; calendars support list/create/update. The remaining
commands mirror the application's event and sharing workflows.

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

`--input event.json` or `--input -` reads a JSON object using snake_case tool field
names. Explicit flags override file fields.

```sh
mmddyy --json events create --input event.json
mmddyy --server http://127.0.0.1:8788 auth login
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
    "mmddyy": { "command": "mmddyy", "args": ["mcp"] }
  }
}
```

Alternatively use `"command": "npx", "args": ["-y", "@mmddyy/cli", "mcp"]`.
The stdio server forwards the hosted tool definitions and calls. It never opens a
browser automatically; run `mmddyy auth login` first. Diagnostics use stderr only.
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
