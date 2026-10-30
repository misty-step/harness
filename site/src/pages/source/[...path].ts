import { getGraph } from '../../lib/content.mjs';
export async function getStaticPaths() {
  const graph = await getGraph();
  return graph.documents.map((document) => ({ params: { path: document.id }, props: { raw: document.raw } }));
}
export function GET({ props }) {
  return new Response(props.raw, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}
