# mistystack

Maintain the OMP method plugin. Read [DOMAIN.md](DOMAIN.md) for terms and
[USER_STORIES.md](USER_STORIES.md) for the affected consumer contract.

## Route the change

| Path | Owns |
| --- | --- |
| `.omp-plugin/` | Native marketplace and plugin manifests |
| `rules/core.md` | Always-on core; keep it at most 20 lines |
| `skills/misty/` | Mode routing, brief contract and task playbooks |
| `skills/principle-*/` | One principle per on-demand leaf |
| `skills/` | Task procedures; frontmatter follows DOMAIN.md |
| `agents/` | Role-backed task agents; setup owns model assignments |
| `.agents/skills/verify-mistystack/` | This repository's consumer proof |
| `scripts/`, `.github/`, `.githooks/` | Checks, release protection and secret scanning |
| `docs/guide/`, `docs/references.md`, `ATTRIBUTION.md` | Human guide, reading and source notices |
| `docs/decisions/`, `docs/postmortems/` | Decisions and incident records; historical paths remain historical |

Edit maintained source, not installed plugin copies. Keep one home per fact;
migrate callers before deleting an old path. Fleet runtime, credentials, hosts,
launchers and Kaylee belong to private `misty-step/workstation`.

## Verify and release

Run `./scripts/check` for the maintained suites. For changed loading or install
behavior, follow [verify-mistystack](.agents/skills/verify-mistystack/SKILL.md),
including isolated installation and fresh-session proof. Report measured results
and any unproved path separately.

`./scripts/bootstrap` installs repository secret-scanning hooks. Landmark owns
CHANGELOG.md and release publication; follow
[docs/release-convention.md](docs/release-convention.md).
