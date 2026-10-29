import { canonical } from '../lib/release.mjs';
export function GET() {
  return new Response(`User-agent: *\nAllow: /\nDisallow: /source/\nDisallow: /search/\nSitemap: ${canonical}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain' } });
}
