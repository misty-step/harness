# Verification

Run the affected native checks and exercise the real user path. Code that ships
gets one independent review; documents, briefs and measurements do not need one.

```sh
./scripts/check shared
./scripts/check pi
./scripts/check omp
./scripts/check all
```

`check` delegates to `verify`. Bun tests read working files. The isolated installer
check clones committed HEAD and runs both installers in disposable homes. It
preserves foreign settings, authentication, sessions and project MCP state.
Git, Bun, jq and Python 3 are required. Display tests also use bubblewrap and
slirp4netns; host-boundary tests need a host namespace with `/dev/net/tun`, not
an already-isolated engineer namespace. Report that limitation rather than
calling an unexercised desktop boundary verified.

No semantic model, foundation adoption, prose-density review or story-deletion
judgment runs in hooks or CI. Secret scanning remains. The optional Landmark
replay tests its existing release behavior when `LANDMARK_BIN` is supplied.

## Native launch proof

```sh
python3 omp-config/bin/omp-engineer.py -- --version
python3 omp-config/bin/omp-engineer.py -- read FOUNDATIONS.md
```

The launcher executes the retained native OMP binary directly inside an existing
private desktop namespace, otherwise through the desktop boundary. It performs
no memory measurement, cgroup admission, ticket/roster lookup, provider probe,
launch lock or systemd handoff. The display boundary keeps host display sockets,
input devices, browser supervisors, private Hermes state and desktop configuration
out of engineer authority. Other home config and executable paths stay writable.

## Scoped deployment

From merged source:

```sh
OMP_INSTALL_COMPONENTS='config guidance cli' ./omp-config/install
./agent-config/install --agent-dir "$(omp config path)" \
  --skill engineering-operations --skill story-qa --skill user-stories \
  --skill visual-state-review --skill remote-execution --skill design-studio
PI_CONFIG_COMPONENTS='guidance skills' ./pi-config/install
```

`cli` replaces `omp-engineer` and the display helpers, deletes stale `omp-roster`
and its experiment controller, lifts the owned slice and active engineer scope
memory limits, then removes `omp.slice`. It does not stop or relocate processes.
Fresh sessions prove loading; updating files does not reload old sessions.

Shared installs remove owned stale check launchers, desktop-guard and foundation
skills, and lift/remove its owned development slice limits. Pi installs remove
automatic diff review and continuation packages. OMP guidance removes watchdog
files. The unmanaged terminal slice and any foreign host limits are not changed.
Credential values, foreign runtime state, journals and SOUL are preserved.
