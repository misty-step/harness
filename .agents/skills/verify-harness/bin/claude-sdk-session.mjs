// Exercise the native SDK launch shape used by T3's makeClaudeQueryOptions.
// The caller supplies the SDK module shipped with its T3 version.
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';

const [sdk, executable, cwd, output, prompt] = process.argv.slice(2);
const { query } = await import(pathToFileURL(sdk).href);
async function* messages() {
  yield { type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null };
}
const events = [];
for await (const event of query({ prompt: messages(), options: {
  pathToClaudeCodeExecutable: executable,
  cwd,
  additionalDirectories: [cwd],
  model: 'haiku',
  tools: [],
  includePartialMessages: true,
  includeHookEvents: true,
  systemPrompt: { type: 'preset', preset: 'claude_code', append: 'T3 native SDK startup verification.' },
  env: { ...process.env },
} })) {
  events.push(event);
}
await writeFile(output, events.map(event => JSON.stringify(event)).join('\n') + '\n');
