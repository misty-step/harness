#!/usr/bin/env python3
"""Persist fresh account transitions before delivering them to Home."""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile

UTC = dt.timezone.utc


def moment(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.astimezone(UTC) if parsed.tzinfo else None
    except ValueError:
        return None


def fresh(value, now, maximum):
    at = moment(value)
    return at is not None and 0 <= (now - at).total_seconds() <= maximum


def percent(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 100


def observation(row, now, quota_age, probe_age):
    quota = row.get('quota', {})
    if quota.get('state') in ('current', 'partial') and fresh(quota.get('observed_at'), now, quota_age):
        windows = [quota.get(key) or {} for key in ('five_hour', 'weekly')]
        if any(moment(window.get('resets_at')) is not None and moment(window['resets_at']) <= now for window in windows):
            return None
        known = [window for window in windows if percent(window.get('room_percent'))]
        if known:
            empty = [window for window in known if window['room_percent'] == 0]
            resets = [moment(window.get('resets_at')) for window in empty]
            resets = [reset for reset in resets if reset is not None and reset > now]
            if empty or len(known) == len(windows):
                return {'state': 'limited' if empty else 'works', 'observed_at': quota['observed_at'],
                        'resets_at': max(resets).isoformat() if resets else None,
                        'source': quota.get('source'), 'model': None}
    probe = row.get('probe', {})
    if probe.get('state') in ('works', 'limited') and fresh(probe.get('observed_at'), now, probe_age):
        return {key: probe.get(key) for key in ('state', 'observed_at', 'resets_at', 'source', 'model')}
    return None


def transition(state, room, now):
    if room.get('schema_version') != 1 or not isinstance(room.get('accounts'), list):
        raise ValueError('invalid room document')
    limits = [room.get(key) for key in ('quota_max_age_s', 'probe_max_age_s')]
    if any(not isinstance(n, (int, float)) or isinstance(n, bool) or not 0 < n <= 600 for n in limits):
        raise ValueError('invalid room freshness limits')
    for row in room['accounts']:
        if not isinstance(row, dict) or not row.get('email'):
            continue
        key = json.dumps([row['provider'], row['email']], separators=(',', ':'))
        sample = observation(row, now, *limits)
        if sample is None:
            continue
        previous = state['accounts'].get(key)
        if previous and moment(sample['observed_at']) <= moment(previous['observed_at']):
            continue
        state['accounts'][key] = sample
        changed = sample['state'] == 'limited' and (not previous or previous['state'] != 'limited')
        recovered = sample['state'] == 'works' and previous and previous['state'] == 'limited'
        if changed or recovered:
            identity = f"{key}:{sample['state']}:{sample['observed_at']}"
            state['pending'].append({'id': hashlib.sha256(identity.encode()).hexdigest()[:16],
                                     'provider': row['provider'], 'email': row['email'],
                                     'instance_id': row.get('instance_id'), **sample})
    return state


def save(path, state):
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as out:
        temp = Path(out.name)
        try:
            os.chmod(temp, 0o600)
            json.dump(state, out)
            out.write('\n')
            out.flush()
            os.fsync(out.fileno())
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def message(event, url):
    status = 'hit a provider limit' if event['state'] == 'limited' else 'works again'
    model = f" on {event['model']}" if event.get('model') else ''
    reset = event.get('resets_at') or 'not supplied by provider'
    return (f"{event['provider']} · {event['email']} ({event.get('instance_id') or 'instance unknown'}) {status}{model}.\n\n"
            f"Observed: {event['observed_at']}. Source: {event.get('source') or 'unknown'}. Reset: {reset}.\n\n"
            f"[Live account room]({url})\n\nEvent: `{event['id']}`\n")


def run(path, room, now, url, deliver):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path.with_suffix('.lock'), 'a') as lock:
        os.chmod(lock.name, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = json.loads(path.read_text()) if path.exists() else {'schema_version': 1, 'accounts': {}, 'pending': []}
        if state.get('schema_version') != 1 or not isinstance(state.get('accounts'), dict) or not isinstance(state.get('pending'), list):
            raise ValueError('invalid event state')
        transition(state, room, now)
        save(path, state)
        while state['pending']:
            deliver(message(state['pending'][0], url))
            state['pending'].pop(0)
            save(path, state)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, default=Path.home() / '.local/state/t3-accounts/room-events.json')
    parser.add_argument('--evidence-url', default=os.environ.get('T3_ACCOUNTS_ROOM_URL', ''))
    args = parser.parse_args()
    if not args.evidence_url.startswith('https://'):
        parser.error('--evidence-url must be an HTTPS URL')
    def deliver(body):
        subprocess.run(['home', 'post', '--from', 'Accounts'], input=body, text=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60, check=True)
    try:
        room = json.load(sys.stdin)
        run(args.state, room, dt.datetime.now(UTC), args.evidence_url, deliver)
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        print('t3-accounts: room event processing failed; pending events retained', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
