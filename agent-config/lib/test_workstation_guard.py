"""The guard parses the command and decides from native hook JSON alone; no harness or host is touched."""
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

SOURCE = Path(os.environ.get('WORKSTATION_GUARD_SOURCE', Path(__file__).resolve().parents[1] / 'bin/workstation-guard'))
spec = spec_from_loader('workstation_guard', SourceFileLoader('workstation_guard', str(SOURCE)))
guard = module_from_spec(spec)
spec.loader.exec_module(guard)

REFUSED = [
    # Privileged or host-device containers and VMs
    'docker run --privileged hello-world',
    'docker run --privileged=true alpine true',
    'sudo docker run -it --rm --privileged alpine sh',
    'podman run --device /dev/fuse alpine true',
    'docker run --device=/dev/dri:/dev/dri x',
    'docker run -v /dev:/dev alpine true',
    'docker run -v/dev/console:/dev/console alpine true',
    'docker run --volume=/dev/tty1:/dev/tty1 alpine true',
    'docker run --mount type=bind,source=/dev/console,target=/dev/console alpine true',
    'nerdctl run --pid=host alpine true',
    'docker run --pid host alpine true',
    'podman run --ipc=host --userns=host --uts=host alpine true',
    'docker run --systemd=always fedora',
    'docker run fedora /sbin/init',
    'docker run --entrypoint /usr/lib/systemd/systemd fedora',
    'docker buildx build --allow security.insecure .',
    'incus launch images:debian/12 box -c security.privileged=true',
    'lxc launch ubuntu:24.04 box --device gpu,type=gpu',
    'incus config device add box gpu0 gpu',
    'systemd-nspawn -b -D /var/lib/machines/x',
    'systemd-nspawn --bind=/dev -D /var/lib/machines/x true',
    'qemu-system-x86_64 -device vfio-pci,host=01:00.0',
    'qemu-system-x86_64 -drive file=/dev/sda,format=raw',
    # Power
    'reboot', 'sudo shutdown -h now', '/usr/bin/poweroff', 'halt', 'systemctl reboot', 'sudo systemctl poweroff',
    'systemctl --now suspend', 'systemctl kexec', 'systemctl start reboot.target', 'systemctl isolate rescue.target',
    'init 0', 'omarchy-system-reboot', 'echo b > /proc/sysrq-trigger', 'echo o | sudo tee /proc/sysrq-trigger',
    'loginctl terminate-session 2', 'loginctl terminate-user phaedrus', 'loginctl kill-session c1',
    # Kill by name or in bulk
    'pkill -0 nonexistent', 'pkill -f chrome', 'sudo killall node', 'killall -9 hyprland', 'kill -9 -1', 'kill 0',
    # Display, session and compositor
    'systemctl restart sddm', 'sudo systemctl stop display-manager.service', 'systemctl restart gdm',
    'systemctl restart user@1000.service', 'systemctl restart getty@tty1', 'systemctl --user stop graphical-session.target',
    'service lightdm restart', 'hyprctl dispatch exit', 'uwsm stop',
    # Looking through wrappers, substitutions and control flow
    'echo ok; pkill foo', 'true && pkill foo', 'false || reboot', 'ls | xargs pkill', 'env FOO=1 pkill foo',
    'sudo -u root -- pkill foo', 'nohup pkill foo &', 'timeout 5 reboot', 'bash -c "pkill foo"', "sh -lc 'systemctl reboot'",
    'sudo bash -c "docker run --privileged x"', 'echo $(pkill foo)', 'echo `reboot`', 'echo "$(pkill foo)"',
    'for p in a b; do pkill $p; done', '(pkill foo)', '{ pkill foo; }', 'eval "pkill foo"', 'FOO=1 \\pkill foo',
    'bash <<EOF\npkill foo\nEOF', 'echo hi\npkill foo', 'cat x | bash -c "$(echo; pkill foo)"',
]

ALLOWED = [
    'docker run hello-world', 'docker ps', 'docker run -v /tmp/x:/x --rm alpine true', 'docker run -v /dev/shm:/dev/shm alpine true',
    'docker run --rm -it --network=host alpine true', 'docker compose up -d', 'podman images', 'incus launch images:debian/12 box',
    'qemu-system-x86_64 -m 1024 -drive file=disk.img', 'systemd-nspawn -D /var/lib/machines/x true',
    'kill 1234', 'kill -9 4321', 'kill -s TERM 99', 'pgrep node', 'ps aux | grep pkill',
    'systemctl --user restart some-app.service', 'systemctl status sddm', 'systemctl restart nginx', 'systemctl daemon-reload',
    'systemctl -H hetzner-ci reboot', 'ssh hetzner-ci sudo reboot', 'ssh exe.dev new --name probe', 'loginctl list-sessions',
    'service nginx restart', 'hyprctl dispatch workspace 2', 'hyprctl monitors', 'init', 'command -v pkill', 'which reboot',
    'git commit -m "never use pkill"', "git commit -m 'reboot the box is refused by --privileged'", 'echo pkill foo', 'echo "docker run --privileged"',
    'grep -rn -- --privileged docs/', 'cat docs/privileged.md  # reboot', 'sed -n 1,5p README.md', 'man docker-run',
    'gh pr create --body "avoid pkill, reboot and docker --privileged"', 'cat <<EOF\npkill foo\nreboot\nEOF',
    "git commit -F - <<'MSG'\nUse docker run --privileged never\nMSG", 'echo $(date)', 'echo "unterminated $(', '', '   ',
]


def run(payload, host='mirrodin', hosts='mirrodin', raw=None):
    stdin = io.StringIO(raw if raw is not None else json.dumps(payload))
    err = io.StringIO()
    env = {} if hosts is None else {'WORKSTATION_GUARD_HOSTS': hosts}
    with patch('sys.stdin', stdin), patch('sys.stderr', err), patch.dict(os.environ, env, clear=False), \
            patch('socket.gethostname', return_value=host):
        if hosts is None:
            os.environ.pop('WORKSTATION_GUARD_HOSTS', None)
        return guard.main(), err.getvalue()


def bash(command, **kwargs):
    return run({'tool_name': 'Bash', 'tool_input': {'command': command}}, **kwargs)


class WorkstationGuardTest(unittest.TestCase):
    def test_refuses_each_class(self):
        for command in REFUSED:
            with self.subTest(command=command):
                code, message = bash(command)
                self.assertEqual(code, 2, message)

    def test_allows_everyday_and_remote_work(self):
        for command in ALLOWED:
            with self.subTest(command=command):
                self.assertEqual(bash(command), (0, ''))

    def test_refusal_names_the_refusal_and_the_remote_alternatives(self):
        code, message = bash('docker run --privileged hello-world')
        self.assertEqual(code, 2)
        self.assertIn('privileged container', message)
        self.assertIn('docker run --privileged hello-world', message)
        self.assertIn('exe.dev', message)
        self.assertIn('remote-execution', message)
        self.assertIn('ssh hetzner-ci', message)
        self.assertIn('never agent sessions', message)

    def test_only_workstations_are_guarded(self):
        self.assertEqual(bash('pkill foo', host='hetzner-ci', hosts=None), (0, ''))
        self.assertEqual(bash('pkill foo', host='unknown', hosts=None), (0, ''))
        for host in ('mirrodin', 'serenity', 'nassau', 'Mirrodin.tail5f5eb4.ts.net'):
            self.assertEqual(bash('pkill foo', host=host, hosts=None)[0], 2, host)
        self.assertEqual(bash('pkill foo', hosts='other')[0], 0)
        self.assertEqual(bash('pkill foo', hosts='')[0], 0)

    def test_only_the_shell_tool_is_inspected(self):
        for name in ('Edit', 'Write', 'Read', 'apply_patch', 'WebFetch', 'mcp__x__run'):
            self.assertEqual(run({'tool_name': name, 'tool_input': {'command': 'pkill foo', 'content': 'reboot'}}), (0, ''))

    def test_fails_open_on_malformed_input(self):
        for raw in ('', 'not json', '[]', '{}', '{"tool_name": "Bash"}', '{"tool_name": "Bash", "tool_input": null}',
                    '{"tool_name": "Bash", "tool_input": {"command": 5}}', '{"tool_name": "Bash", "tool_input": {"command": null}}'):
            with self.subTest(raw=raw):
                self.assertEqual(run(None, raw=raw), (0, ''))

    def test_a_shell_argv_list_is_joined(self):
        self.assertEqual(run({'tool_name': 'Bash', 'tool_input': {'command': ['pkill', 'foo']}})[0], 2)

    def test_deeply_nested_input_fails_open(self):
        self.assertEqual(bash('$(' * 5000 + 'pkill foo' + ')' * 5000), (0, ''))


if __name__ == '__main__':
    unittest.main()
