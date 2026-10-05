import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'foundation-selection-'));
afterAll(() => rmSync(root, {recursive:true, force:true}));
const script = join(import.meta.dir, 'foundation-check.ts');
function git(repo: string, ...args: string[]) {
  const r = spawnSync('git',args,{cwd:repo,encoding:'utf8'});
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}
function put(repo: string, path: string, text: string) {mkdirSync(dirname(join(repo,path)),{recursive:true});writeFileSync(join(repo,path),text);}
function commit(repo: string) {git(repo,'add','.');git(repo,'-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','fixture');return git(repo,'rev-parse','HEAD');}
const map = {mode:'shadow',cheap:['lint'],full:['unit:all','walk:all'],toolchain:{go:'1.27.1'},broaden:['go.mod','contracts/**'],metadata:['docs/**'],
  components:[{id:'shared',paths:['shared/**'],tests:['unit:shared'],dependsOn:[]},
    {id:'learning',paths:['learning/**'],tests:['unit:learning'],dependsOn:['shared']},
    {id:'web',paths:['web/**'],tests:['unit:web'],dependsOn:['learning']}]};
function fixture(name: string, selection: unknown = map) {
  const repo=join(root,name);mkdirSync(repo);git(repo,'init','-q');
  put(repo,'foundation.json',JSON.stringify({affected_tests:selection}));
  put(repo,'shared/grade.go','good');put(repo,'shared/grade_test.go','test');put(repo,'learning/policy.go','good');
  put(repo,'go.mod','module fixture');commit(repo);
  const base=git(repo,'rev-parse','HEAD');
  return {repo,base};
}
const resultSchema = {
  parse(output: string) {
    const value: unknown = JSON.parse(output);
    if (!value || typeof value !== 'object' || !('selection' in value) || !('ok' in value)) throw new Error(output);
    // Validate observable fields used below rather than asserting a result shape.
    const selection = value.selection;
    if (!selection || typeof selection !== 'object' || !('selected' in selection) || !('eligible' in selection) ||
      !('candidateTree' in selection) || !('inputKey' in selection) || !('results' in selection)) throw new Error(output);
    return {ok:value.ok,selection};
  }
};
function cli(repo: string, base: string, ...args: string[]) {
  const r = spawnSync('bun',['--no-env-file',script,'test-selection','--repo',repo,'--base',base,'--current-main',base,'--json',...args],
    {cwd:tmpdir(),encoding:'utf8'});
  return {status:r.status,...resultSchema.parse(r.stdout)};
}
function receipt(repo: string, base: string, selected: string[], result='passed') {
  const selection=cli(repo,base).selection;
  const path=join(root,`${dirname(repo).split('/').pop()}-${repo.split('/').pop()}.json`);
  writeFileSync(path,JSON.stringify({runner:'synthetic-runner',baseSha:base,candidateTree:selection.candidateTree,
    inputKey:selection.inputKey,results:selected.map(test=>({test,result}))}));
  return path;
}

describe('Rule A through existing foundation checker CLI',()=>{
  test('unmapped paths fall back to full suite, cheap checks always run',()=>{
    const {repo,base}=fixture('unmapped');put(repo,'new/unknown.go','new');commit(repo);
    expect(cli(repo,base).selection.selected).toEqual(['lint','unit:all','walk:all']);
  });
  test('deleted shared source selects every reverse dependent',()=>{
    const {repo,base}=fixture('deleted-shared');rmSync(join(repo,'shared/grade.go'));commit(repo);
    expect(cli(repo,base).selection.selected).toEqual(['lint','unit:learning','unit:shared','unit:web']);
  });
  test('candidate cannot remove tests and manufacture green',()=>{
    const {repo,base}=fixture('remove-test');rmSync(join(repo,'shared/grade_test.go'));commit(repo);
    const selected=['lint','unit:all','unit:learning','unit:shared','unit:web','walk:all'];
    expect(cli(repo,base,'--test-results',receipt(repo,base,selected)).selection.eligible).toBe(false);
  });
  test('removing test bodies or required checks cannot grant eligibility',()=>{
    for (const path of ['shared/grade_test.go','.github/workflows/ci.yml']) {
      const {repo}=fixture(path.includes('.github')?'remove-gate':'remove-body');
      put(repo,path,'required assertion\n');const base=commit(repo);
      put(repo,path,'');commit(repo);
      expect(cli(repo,base,'--test-results',receipt(repo,base,['lint','unit:all','unit:learning','unit:shared','unit:web','walk:all'])).selection.eligible).toBe(false);
    }
  });
  test('current main movement invalidates an otherwise passing receipt',()=>{
    const {repo,base}=fixture('movement');put(repo,'learning/policy.go','fixed');const moved=commit(repo);
    const path=receipt(repo,base,['lint','unit:learning','unit:web']);
    expect(cli(repo,base,'--test-results',path).selection.eligible).toBe(true);
    expect(cli(repo,base,'--test-results',path,'--current-main',moved).selection.eligible).toBe(false);
  });
  test('candidate selector edits use trusted base and cannot grant eligibility',()=>{
    const {repo,base}=fixture('weaken');put(repo,'foundation.json',JSON.stringify({affected_tests:{...map,cheap:[],components:[]}}));commit(repo);
    const selection=cli(repo,base).selection;expect(selection.selected).toEqual(['lint','unit:all','walk:all']);
    expect(cli(repo,base,'--test-results',receipt(repo,base,['lint','unit:all','walk:all'])).selection.eligible).toBe(false);
  });
  test('unknown dependencies cause exhaustive fallback',()=>{
    const {repo,base}=fixture('incomplete',{...map,components:[...map.components,{id:'broken',paths:['broken/**'],tests:['broken'],dependsOn:['missing']}]});
    put(repo,'shared/grade.go','changed');commit(repo);
    expect(cli(repo,base).selection.selected).toEqual(['full-ci']);
  });
  test('shared, dependency and contract failures stay red in shadow mode',()=>{
    for(const [name,path,selected] of [
      ['shared','shared/grade.go',['lint','unit:learning','unit:shared','unit:web']],
      ['dependency','go.mod',['lint','unit:all','walk:all']],
      ['contract','contracts/grading.json',['lint','unit:all','walk:all']],
    ]) {
      if (typeof name !== 'string' || typeof path !== 'string' || !Array.isArray(selected)) throw new Error('bad fixture');
      const {repo,base}=fixture(name);put(repo,path,'BROKEN');commit(repo);
      expect(cli(repo,base).selection.selected).toEqual(selected);
      const failed=cli(repo,base,'--test-results',receipt(repo,base,selected,'failed')).selection;
      expect(failed.eligible).toBe(false);
      expect(failed.results).toEqual({passed:[],failed:selected,skipped:[],flaky:[],cached:[]});
    }
  });
  test('receipt for old candidate cannot pass changed source',()=>{
    const {repo,base}=fixture('stale-receipt');put(repo,'learning/policy.go','changed');commit(repo);
    const path=receipt(repo,base,['lint','unit:learning','unit:web']);put(repo,'learning/policy.go','changed again');commit(repo);
    expect(cli(repo,base,'--test-results',path).status).toBe(1);
  });
  test('passed, failed, skipped, flaky and cached stay separate; no new cache reuse',()=>{
    const {repo,base}=fixture('results');put(repo,'learning/policy.go','changed');commit(repo);
    const selection=cli(repo,base).selection;const path=join(root,'results.json');
    writeFileSync(path,JSON.stringify({runner:'runner',baseSha:base,candidateTree:selection.candidateTree,inputKey:selection.inputKey,
      results:[{test:'lint',result:'passed'},{test:'unit:learning',result:'failed'},{test:'unit:web',result:'skipped'},
        {test:'extra',result:'flaky'},{test:'cache',result:'cached'}]}));
    const observed=cli(repo,base,'--test-results',path).selection;
    expect(observed.results).toEqual({passed:['lint'],failed:['unit:learning'],skipped:['unit:web'],flaky:['extra'],cached:['cache']});
    expect(observed.eligible).toBe(false);
  });
});
