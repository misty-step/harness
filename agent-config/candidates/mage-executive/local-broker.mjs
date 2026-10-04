// Local-only bridge to the Rust capability broker. Never load on Cloudflare.
import { spawn } from 'node:child_process';
export function processBroker(binary, configPath) {
  return (request, signal) => new Promise((resolve,reject) => {
    const stdio = ['pipe','pipe','pipe'];
    if (process.env.MAGE_OWNER_FD === '3') stdio.push(3);
    const child = spawn(binary,['tool',configPath],{stdio});
    const output=[]; let bytes=0, error='', exceeded=false, aborted=false;
    const stop = () => { aborted=true; child.kill('SIGTERM'); };
    if (signal?.aborted) stop(); else signal?.addEventListener('abort',stop,{once:true});
    child.stdout.on('data',chunk=>{ bytes+=chunk.length; if (bytes <= 512*1024) output.push(chunk); else exceeded=true; });
    child.stderr.on('data',chunk=>{ if (Buffer.byteLength(error)+chunk.length <= 8192) error+=chunk; });
    child.on('error',reject);
    child.on('close',code=>{
      signal?.removeEventListener('abort',stop);
      if (aborted || code!==0 || exceeded) return reject(new Error(error.trim() || 'broker unavailable; inspect effect intent'));
      try { resolve(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(output)))); } catch { reject(new Error('invalid broker receipt')); }
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}
