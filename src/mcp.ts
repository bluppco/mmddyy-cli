import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { connect } from './client';
import type { AuthStore } from './auth';
import { version } from './version';

export async function serveStdio(store: AuthStore) {
  const remote = await connect(store);
  const local = new Server({ name: 'mmddyy', version }, { capabilities: { tools: {} } });
  try {
    local.setRequestHandler('tools/list', request => remote.listTools(request.params));
    local.setRequestHandler('tools/call', request => remote.callTool(request.params));
    const transport = new StdioServerTransport();
    await local.connect(transport);
    await new Promise<void>(resolve => {
      let closing = false;
      const close = () => {
        if (closing) return; closing = true;
        void Promise.all([local.close(), remote.close()]).then(() => resolve(), () => resolve());
      };
      process.stdin.once('end', close);
      process.once('SIGINT', close); process.once('SIGTERM', close);
    });
  } finally { await remote.close(); }
}
