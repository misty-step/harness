import { release } from '../lib/release.mjs';
export function GET() {
  return new Response(JSON.stringify(release, null, 2), { headers: { 'Content-Type': 'application/json' } });
}
