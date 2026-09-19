import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { connect } from './client';
import { cliFailure, type AuthStore } from './auth';
import { operations, toolDefinition, type OperationName } from '../../mcp/src/contracts';
import { version } from './version';

export function createLocalServer(store: AuthStore) {
  const local = new McpServer({ name: 'mmddyy', version });
  let connection: ReturnType<typeof connect> | undefined;
  const disconnect = async () => {
    const previous = connection;
    connection = undefined;
    if (previous) await previous.then(client => client.close(), () => {});
  };
  for (const name of Object.keys(operations) as OperationName[]) {
    local.registerTool(name, toolDefinition(name), async (input: unknown) => {
      let attempted: ReturnType<typeof connect> | undefined;
      try {
        attempted = connection ??= connect(store);
        const remote = await attempted;
        return await remote.callTool({ name, arguments: input as Record<string, unknown> });
      } catch (error) {
        if (connection === attempted) await disconnect();
        const failure = cliFailure(error, store.origin);
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: {
          code: failure.code, message: failure.message, status: failure.status,
          ...(failure.recovery ? { recovery: failure.recovery } : {}),
        } }) }] };
      }
    });
  }
  return { local, disconnect };
}

export async function serveStdio(store: AuthStore) {
  const { local, disconnect } = createLocalServer(store);
  try {
    const transport = new StdioServerTransport();
    await local.connect(transport);
    await new Promise<void>(resolve => {
      const close = () => resolve();
      process.stdin.once('end', close);
      process.once('SIGINT', close); process.once('SIGTERM', close);
    });
  } finally { await local.close(); await disconnect(); }
}
