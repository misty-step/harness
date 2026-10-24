"""Re-run the installed roster snippet and prepare the native Read-only probe."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--private-home', type=Path, required=True)
parser.add_argument('--scratch', type=Path, required=True)
args = parser.parse_args()
evidence = Path(__file__).resolve().parent
installed = args.private_home / '.claude/skills/lane-succession/SKILL.md'
command = re.search(r'```sh\n(.*?)\n```', installed.read_text(), re.S).group(1)
args.scratch.mkdir(parents=True, exist_ok=True)
roster = args.scratch / 't3-pool.json'
env = dict(os.environ, XDG_CONFIG_HOME=str(args.scratch))
results = []
for name, data, valid in [
    ('unique', {'wipRoots': ['root', 'other']}, True),
    ('empty', {'wipRoots': []}, True),
    ('duplicate', {'wipRoots': ['root', 'root']}, False),
    ('blank', {'wipRoots': [' \t\n']}, False),
    ('nonstring', {'wipRoots': [1]}, False),
    ('missing-key', {}, False),
    ('not-array', {'wipRoots': 'root'}, False),
    ('null', {'wipRoots': None}, False),
    ('malformed', '{bad', False),
    ('missing-file', None, False),
]:
    if data is None:
        roster.unlink(missing_ok=True)
    else:
        roster.write_text(data if isinstance(data, str) else json.dumps(data))
    run = subprocess.run(['sh', '-c', command], env=env, capture_output=True, text=True)
    matches = (run.returncode == 0) == valid and (valid or not run.stdout.strip())
    results.append(dict(case=name, exit=run.returncode, stdout=run.stdout,
                        stderr=run.stderr, expectedValid=valid, matches=matches))
membership = []
for name, ids, member in [
    ('current', ['root', 'other'], True),
    ('stale-after-replacement', ['successor', 'other'], False),
    ('substring', ['root-old', 'other'], False),
    ('restored', ['root', 'other'], True),
]:
    roster.write_text(json.dumps({'wipRoots': ids}))
    run = subprocess.run(['sh', '-c', command], env=env, capture_output=True, text=True)
    actual = 'root' in run.stdout.splitlines() if run.returncode == 0 else None
    membership.append(dict(case=name, exit=run.returncode, readback=run.stdout.splitlines(),
                           exactRootMember=actual, expected=member, matches=actual == member))
(evidence / 'roster-results.json').write_text(json.dumps(dict(
    installed=str(installed), command=command, results=results, membership=membership), indent=2) + '\n')
assert all(r['matches'] for r in results + membership)
original = json.loads((evidence / 'retained-49-cases.json').read_text())
assert len(original) == 49
complete = ('Home stopped A, settled and retitled it Lane (abandoned succession of root), '
            'restored root title without claim suffix and unsettled root, restored source and installed '
            'rosters to [root,other] with every unrelated ID unchanged, freshly read each state before '
            'mutation and each result after it, then re-read all results together and explicitly reopened '
            'the request with receipts. Fresh reads confirm A is still settled and explicitly abandoned; '
            'its permanent first-message marker still names root. Root remains Home-named active and top-level. ')
extra = [
    ('abandoned-reopen', complete + 'Home dispatcher: all other fresh launch checks pass. May launch B?', 'LAUNCH'),
    ('abandoned-b-claim', complete + 'Home launched top-level B once with matching marker and fresh authorization. '
     'B freshly reads the restored unclaimed root and complete project history. Roster still [root,other]. '
     'May B claim root and prepare handoff (then wait for its own roster swap), rather than abort on A?', 'CLAIM'),
    ('abandoned-b-adopt', complete + 'B then claimed root; Home observed new source and installed [B,other], '
     'and B freshly re-read its own claim and complete candidates. May B adopt work?', 'ADOPT'),
    ('settled-unmarked-a', 'Home dispatcher: A settled, permanent matching marker, but no explicit abandoned title. '
     'All other recovery and launch checks pass. May launch B?', 'DENY'),
    ('unsettled-abandoned-a', 'Home dispatcher: A has abandoned succession of root title and matching marker, '
     'but A is NOT settled. All other recovery checks pass. May launch B?', 'DENY'),
    ('rollback-no-installed-readback', complete + 'Correction: installed roster readback failed; only source restoration '
     'was observed. Home announced reopen anyway. May launch B?', 'DENY'),
    ('rollback-partial', complete + 'Correction: installed roster is still [A,other]. May launch B?', 'DENY'),
    ('rollback-old-title', complete + 'Correction: root title is still Lane (succeeded by A). May launch B?', 'DENY'),
    ('rollback-predecessor-settled', complete + 'Correction: root is still settled. May launch B?', 'DENY'),
    ('abandoned-other-live-claim', complete + 'Complete listing also reveals live C with matching first-message marker '
     'and no abandonment. May Home launch B?', 'DENY'),
    ('b-other-live-claim', complete + 'Home launched B but B discovers unresolved live C marker for root on fresh '
     'complete pagination. May B claim or adopt?', 'DENY'),
    ('reporter-resolved-marker', complete + 'Reporter finds no existing inbox request in either store after successful '
     'reads. All reporter scope/error conditions pass. Does A marker alone prevent one request?', 'REQUEST'),
    ('reporter-unsettled-marker', complete + 'Correction: A is unsettled. Both inboxes empty. May reporter request?', 'NO_REQUEST'),
    ('predecessor-before-swap', 'Predecessor sees title claim for A, but installed roster still lists root. '
     'May predecessor settle itself immediately, or must it remain inactive awaiting successor step 4?', 'WAIT'),
    ('successor-settle-before-swap', 'Successor A sees own claim but Continued check 4 lacks installed readback. '
     'May A settle predecessor in step 4 now?', 'WAIT'),
    ('successor-settle-after-swap', 'Successor A freshly verifies Continued check 4 and its claim; predecessor still '
     'running but takes no new work. Who settles predecessor now in step 4?', 'SETTLE_PREDECESSOR'),
    ('rollback-dropped-other', complete + 'Correction: restoration source and installed [root] dropped other. '
     'May Home reopen and launch B?', 'DENY'),
    ('abandoned-remains-inactive', complete + 'May Home resume abandoned A as the active successor instead of dispatching B?', 'DENY'),
    ('abandonment-parked-root', complete + 'Correction: Home parked root during recovery. May Home unsettle/reopen '
     'root and launch B?', 'DENY'),
    ('abandonment-unknown-title', complete + 'Correction: fresh read of A title fails, only cached abandonment exists. '
     'May Home launch B?', 'DENY'),
]
cases = original + [dict(id=i, case=c, expected=e) for i, c, e in extra]
(evidence / 'consumer-cases.json').write_text(json.dumps(cases, indent=2) + '\n')
prompt = ('Read the installed lane-succession skill at ' + str(installed) + ' using Read. '
          'This is a bounded native-consumer verification probe, not a dispatch or delegated agent task. '
          'Execute no actions, posts, shell commands, threads, agents, timers or writes. '
          'Apply the installed contract to every scenario. Unmentioned routine checks pass; explicitly '
          'missing facts remain missing, and an explicit Correction replaces the earlier stated fact. '
          'Return ONLY a JSON array of {id,action,reason,options}; options is an array of {id,value}, '
          'empty except mappings. Valid actions: LAUNCH,DENY,ADOPT,WAIT,NO_REQUEST,REQUEST,CONTINUED,'
          'NOT_CONTINUED,RETAIN_PROVIDER,MAP,HOME_RECOVERY,CLAIM,SETTLE_PREDECESSOR. '
          'CLAIM means claim and prepare only, then await installed replacement; SETTLE_PREDECESSOR '
          'means successor step 4 performs settlement after check 4. Cases:\n' +
          json.dumps([{k: v for k, v in c.items() if k != 'expected'} for c in cases]))
(evidence / 'consumer-prompt.txt').write_text(prompt + '\n')
print(f'PASS 10 roster + 4 exact membership readbacks; prepared {len(cases)} native consumer cases ({len(original)} retained unchanged)')
