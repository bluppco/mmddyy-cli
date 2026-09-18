import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { AuthStore, authenticatedFetch, CliError } from './auth';

export async function connect(store: AuthStore) {
  const client = new Client({ name: 'mmddyy-cli', version: '2026.9.18' }, { versionNegotiation: { mode: 'auto' } });
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', store.origin), { fetch: authenticatedFetch(store) });
  try { await client.connect(transport); } catch (error) { await transport.close(); throw error; }
  return client;
}
export async function call(store: AuthStore, name: string, args: Record<string, unknown>) {
  const client = await connect(store);
  try {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) {
      const item = result.content?.find(item => item.type === 'text');
      let error: { code?: string; message?: string; status?: number } = {};
      try { error = JSON.parse(item?.type === 'text' ? item.text : '{}').error ?? {}; } catch { /* Protocol error text is not necessarily JSON. */ }
      throw new CliError(error.message ?? 'Tool call failed.', error.code, error.status);
    }
    return result.structuredContent ?? (result.content?.find(item => item.type === 'text'));
  } finally { await client.close(); }
}
