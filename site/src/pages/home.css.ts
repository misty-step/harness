import { twoLineLength } from '@misty-step/brand/attrs';
import { getGraph } from '../lib/content.mjs';
import { getHome } from '../lib/home.mjs';

// Values the brand markup contract carries in style attributes. This site's
// CSP refuses inline styles, so the build writes them to a same-origin file:
// the headline's two-line length and each trial bar's fill.
export async function GET() {
  const page = getHome(await getGraph());
  const css = [
    `.hero .hero-title{--h2:${twoLineLength(page.hero.headline)}}`,
    ...page.sections.evidence.rows.map((row) => `.bar[data-arm=${JSON.stringify(row.id)}] .bar-fill{--v:${row.passed}/${row.total}}`),
  ];
  return new Response(`${css.join('\n')}\n`, { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
}
