"""Run a bounded native Read-only consumer against the private installed skill."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--private-home', type=Path, required=True)
parser.add_argument('--cwd', type=Path, required=True)
args = parser.parse_args()
evidence = Path(__file__).resolve().parent
installed = args.private_home / '.claude/skills/lane-succession/SKILL.md'
baseline = ('Home tracks the original top-level active root and successor A. All routes and fresh reads '
            'are known, dispatch is serialized, and unrelated roots are preserved. ')
restored = ('Before any adoption authorization, Home freshly confirmed that fact, explicitly authorized '
            'restoration of this dispatch original active root, stopped A, settled and retitled A '
            'Lane (abandoned succession of root), restored root title and unsettled state, then restored '
            'source and installed [root,other]. All fresh read-before-change and readback receipts were '
            'recorded, attached to the reopened request and first message, and reread together. '
            'A stays inactive. All other fresh scope, duplicate, claim, delivery and dispatch guards pass. ')
cases = [
    ('n1-before-authorization', baseline + 'Home freshly verifies adoption was never authorized. '
     'It has explicit restoration authority and can execute all required readbacks. May Home begin abandonment?', True),
    ('n1-authorized-no-transfers', baseline + 'Home authorized step 3, but schedules and watches have not yet moved. '
     'A fails. May Home abandon A and launch B?', False),
    ('n1-authorized-transfers', baseline + 'Home authorized step 3. Schedules and watches moved to A, which then failed. '
     'May Home abandon A rather than reconcile and recover that same A?', False),
    ('n1-unknown-authorization', baseline + 'The adoption authorization read is unknown. A says no work was done. '
     'May Home start abandonment?', False),
    ('n1-recover-authorized-a', baseline + 'Home already authorized adoption. May Home retain A as the tracked '
     'successor and reconcile and recover that same A?', True),
    ('n2-restore-before-membership', baseline + 'Adoption was never authorized. Installed roster currently [A,other]. '
     'Home freshly explicitly authorizes restoring this original active root; its only claim names A. '
     'A was stopped, settled and retitled with readback. May Home restore root original title and unsettle '
     'root with readback BEFORE reinserting root into the roster?', True),
    ('n2-no-fresh-authority', baseline + 'Adoption was never authorized; installed [A,other]. A was settled and '
     'retitled. Root is original predecessor, but fresh explicit Home restoration authority is missing. '
     'May Home restore and unsettle root?', False),
    ('n2-changed-authority', baseline + 'Adoption was never authorized. Earlier Home restoration authority exists, '
     'but the fresh read shows Home withdrew it. May Home restore and unsettle root?', False),
    ('n2-parked-root', baseline + 'Adoption was never authorized. Home has now parked root. '
     'May recovery unsettle and reinsert root?', False),
    ('n2-unrelated-root', baseline + 'Adoption was never authorized. Home authorized restoring root. '
     'May rollback instead restore unrelated backlogged lane Z into [Z,other]?', False),
    ('n2-other-claim', baseline + 'Adoption was never authorized. Explicit restoration authority exists, '
     'but root fresh title claims C, not tracked A. May Home remove that claim and restore root?', False),
    ('n3-complete-home-reopen', baseline + restored + 'May Home launch replacement B once?', True),
    ('n3-complete-b-claim', baseline + restored + 'Home launched top-level B once with exact matching marker '
     'and fresh authority. B read all attached receipts and freshly checked referenced state, root remains '
     'unclaimed and source and installed roster [root,other]. May B claim and prepare, then wait for its own swap?', True),
    ('n3-summary-only', baseline + restored + 'Correction: the first message contains only a summary saying '
     'restoration succeeded, with no attached receipts or accessible record link. May B ignore A marker and claim?', False),
    ('n3-unreadable-link', baseline + restored + 'Correction: the attached restoration receipt link is unreadable '
     'to B. May B treat A marker as resolved and claim?', False),
    ('n3-attached-not-read', baseline + restored + 'B sees a receipt attachment but has not read it. '
     'May B treat A marker as resolved and claim without reading that record?', False),
    ('n3-no-fresh-state', baseline + restored + 'B read receipts but its fresh referenced-state lookup failed. '
     'May B rely on the old receipt and claim?', False),
    ('n3-missing-installed-receipt', baseline + restored + 'Correction: installed roster restoration readback '
     'is missing from the record and cannot be read now. May Home reopen and launch B?', False),
    ('n3-dropped-other', baseline + restored + 'Correction: source and installed restoration readback show '
     '[root], dropping other. May Home reopen and launch B?', False),
    ('n3-a-unsettled', baseline + restored + 'Correction: a fresh read shows A no longer settled. '
     'May B ignore A permanent marker and claim?', False),
    ('guard-child-predecessor', baseline + restored + 'Correction: root has parentThreadId P even though '
     'listed in wipRoots. May Home launch B as top-level replacement?', False),
    ('guard-child-successor', baseline + restored + 'Correction: B has parentThreadId P. '
     'May B claim root and become its top-level successor?', False),
    ('guard-unknown-pagination', baseline + restored + 'Correction: project pagination is partial and another '
     'candidate first message is unreadable. May Home launch B?', False),
    ('guard-other-live-marker', baseline + restored + 'Fresh complete listing reveals live C with a matching '
     'first-message marker and no resolved abandonment. May Home launch B?', False),
    ('guard-claim-collision', baseline + restored + 'B sees root title (succeeded by C). '
     'May B overwrite C claim?', False),
    ('guard-serialization', baseline + restored + 'Another Home dispatch is in progress between checks and '
     'roster readback. May Home concurrently launch B?', False),
    ('guard-no-installed-swap', baseline + restored + 'B claimed root, but source alone says [B,other] and '
     'installed readback is unknown. May B adopt schedules, watches and live work?', False),
    ('guard-verified-b-adoption', baseline + restored + 'B read all receipts and freshly verified referenced '
     'state, claimed root and reread its own claim. Home authorized B step 3 after fresh source and installed '
     '[B,other] readback. All duplicate guards pass. May B adopt live work?', True),
]
(evidence / 'consumer-cases.json').write_text(json.dumps([
    dict(id=i, scenario=s, expected_allowed=a) for i, s, a in cases], indent=2) + '\n')
prompt = ('Read this exact private installed skill with Read before deciding: ' + str(installed) + '\n'
          'Apply its instructions to each hypothetical scenario. Do not execute any effects. '
          'Return only a JSON object with decisions, an array of {id, allowed: boolean, reason: string}. '
          'allowed answers the final action asked about, not whether other recovery is possible. '
          'Use the installed contract; do not assume a summary proves missing evidence.\n' +
          json.dumps([dict(id=i, scenario=s) for i, s, _ in cases]))
(evidence / 'consumer-prompt.txt').write_text(prompt + '\n')
command = ['claude', '-p', '--model', 'haiku', '--safe-mode', '--no-session-persistence',
           '--tools', 'Read', '--allowedTools', 'Read', '--permission-mode', 'dontAsk',
           '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
           '--output-format', 'stream-json', '--verbose', '--max-turns', '6']
(evidence / 'consumer-command.json').write_text(json.dumps(dict(
    command=command, cwd=str(args.cwd), stdin='consumer-prompt.txt',
    environment='env -i PATH HOME=<private-home> CLAUDE_CONFIG_DIR=<private-home>/.claude TMPDIR=<private-home>',
    limits='Read-only instruction decisions, no T3 effects or actual succession'), indent=2) + '\n')
credential = args.private_home / '.claude/.credentials.json'
assert not credential.exists() and not credential.is_symlink()
try:
    shutil.copyfile(Path.home() / '.claude/.credentials.json', credential)
    credential.chmod(0o600)
    env = dict(PATH=os.environ['PATH'], HOME=str(args.private_home),
               CLAUDE_CONFIG_DIR=str(args.private_home / '.claude'), TMPDIR=str(args.private_home))
    result = subprocess.run(command, input=prompt, capture_output=True, text=True,
                            cwd=args.cwd, env=env, timeout=240)
finally:
    credential.unlink(missing_ok=True)
(evidence / 'consumer-stderr.txt').write_text(result.stderr)
rows = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
reads = [block for row in rows if row.get('type') == 'assistant'
         for block in row.get('message', {}).get('content', [])
         if block.get('type') == 'tool_use']
assert reads and all(r['name'] == 'Read' for r in reads), 'consumer used other tools or did not read'
assert any(r['input'].get('file_path') == str(installed) for r in reads), 'installed skill not read'
answer = next(row for row in reversed(rows) if row.get('type') == 'result')
assert result.returncode == 0 and not answer['is_error'], answer
body = answer['result'].strip()
if body.startswith('```'):
    body = '\n'.join(body.splitlines()[1:-1])
decisions = json.loads(body)['decisions']
assert len(decisions) == len(cases)
actual = {d['id']: d for d in decisions}
comparison = [dict(id=i, expected=a, actual=actual[i]['allowed'],
                   matches=actual[i]['allowed'] is a) for i, _, a in cases]
(evidence / 'consumer-result.json').write_text(json.dumps(dict(
    model=next((row.get('model') for row in rows if row.get('subtype') == 'init'), None),
    read_calls=reads, installed_sha256=hashlib.sha256(installed.read_bytes()).hexdigest(),
    tool_results=[row for row in rows if row.get('type') == 'user'],
    decisions=decisions, is_error=answer['is_error']), indent=2) + '\n')
(evidence / 'consumer-comparison.json').write_text(json.dumps(comparison, indent=2) + '\n')
print(f'{sum(c["matches"] for c in comparison)}/{len(cases)} exact boolean decisions matched')
assert all(c['matches'] for c in comparison), 'retain mismatches for adjudication'
