// Historical ADRs retain their original prose and links. These exact files were
// removed, not moved to a current procedure. Link their last retained revisions,
// visibly labelled as archives; never apply this mapping to current guidance.
// Revisions are the verified parents of removals 26f4a5c and b4833325.
export const historicalSources = new Map([
  ['docs/principles/007-braver-engineers-continuous-deployment.md', {
    commit: 'd61f40c849a4fed66347bf060c8e4333ce1bcc91',
    fragments: ['lean-ci-amendment-2026-10-02'],
  }],
  ['docs/principles/009-nothing-fails-silently.md', {
    commit: 'd61f40c849a4fed66347bf060c8e4333ce1bcc91', fragments: [],
  }],
  ['omp-config/README.md', {
    commit: 'd61f40c849a4fed66347bf060c8e4333ce1bcc91',
    fragments: ['authorized-application-management'],
  }],
  ...['agent-config/guidance/workstation.md', 'scripts/probe-agent-policy', '.agents/skills/verify-harness/features/fresh-session.md'].map((file) => [
    file, { commit: 'd61f40c849a4fed66347bf060c8e4333ce1bcc91', fragments: [] },
  ]),
  ['docs/desktop-memory-guard.md', {
    commit: 'afbaf33b3f940108ccaf06c74841c9fbfa812bd0',
    fragments: ['operator-cutover--restarts-every-engineer'],
  }],
  ...['story-deletion-replays-us-051', 'protected-release-walk-us-015'].map((fragment) => [
    `docs/verification.md#${fragment}`,
    { commit: 'afbaf33b3f940108ccaf06c74841c9fbfa812bd0', fragments: [fragment] },
  ]),
  ...['constitution.md', 'foundation-standard-v1.json', 'foundation-standard-v1.md'].map((file) => [
    `agent-config/skills/foundation/${file}`,
    { commit: 'afbaf33b3f940108ccaf06c74841c9fbfa812bd0', fragments: [] },
  ]),
]);
