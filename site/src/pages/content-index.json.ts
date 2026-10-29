import { getGraph } from '../lib/content.mjs';
export async function GET() {
  const graph = await getGraph();
  return new Response(JSON.stringify(graph.index, null, 2), { headers: { 'Content-Type': 'application/json' } });
}
