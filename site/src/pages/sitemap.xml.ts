import { getGraph } from '../lib/content.mjs';
import { publicRoutes } from '../lib/graph.mjs';
import { canonical } from '../lib/release.mjs';
export async function GET() {
  const urls = publicRoutes(await getGraph()).sort().map((route) => `<url><loc>${new URL(route, canonical).href}</loc></url>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { headers: { 'Content-Type': 'application/xml' } });
}
