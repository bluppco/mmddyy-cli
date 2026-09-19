import { expect, test, spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { AuthStore } from '../src/auth';
import { createLocalServer } from '../src/mcp';

test('local MCP lists tools without auth and recovers in the same process after login', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mmddyy-stdio-'));
  const store = new AuthStore('https://mcp.mmddyy.app', directory);
  const { local, disconnect } = createLocalServer(store);
  const client = new Client({ name: 'test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request = new Request(input, init);
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    expect(request.headers.get('Authorization')).toBe('Bearer access');
    const rpc = await request.json() as { id?: number; method: string };
    if (rpc.id === undefined) return new Response(null, { status: 202 });
    const result = rpc.method === 'initialize'
      ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'remote', version: '1' } }
      : { content: [{ type: 'text', text: '{"data":{"id":"alice"}}' }], structuredContent: { data: { id: 'alice' } } };
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result });
  }, { preconnect: () => {} }));
  try {
    await local.connect(serverTransport); await client.connect(clientTransport);
    expect((await client.listTools()).tools).toHaveLength(19);
    const failed = await client.callTool({ name: 'get_account', arguments: {} });
    expect(failed.isError).toBe(true);
    expect(failed.content).toEqual([expect.objectContaining({ text: expect.stringContaining('Create an account') })]);
    const text = failed.content?.find(item => item.type === 'text');
    expect(JSON.parse(text?.type === 'text' ? text.text : '{}')).toMatchObject({ error: { status: 401, code: 'unauthorized', recovery: { login_command: 'mmddyy auth login' } } });
    expect(fetchMock).not.toHaveBeenCalled();
    await store.locked(async (_state, save) => save({ origin: store.origin, client_id: 'client', access_token: 'access', refresh_token: 'refresh', expires_at: Date.now() + 600000, scope: 'read' }));
    const success = await client.callTool({ name: 'get_account', arguments: {} });
    expect(success.isError).not.toBe(true);
    expect(success.structuredContent).toEqual({ data: { id: 'alice' } });
  } finally { await client.close(); await local.close(); await disconnect(); fetchMock.mockRestore(); await rm(directory, { recursive: true, force: true }); }
});
