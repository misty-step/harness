# ADR-001: One repository, three components

Accepted 2026-09-16. Supersedes the separate-repository topology in pi ADR-021,
not its shared-primitive ownership boundary.

Both harnesses already consume sibling source from agent-config. Independent
repositories did not pin compatible revisions and left workspace AGENTS.md outside
version control. The same maintainer coordinates all three. Extracting shared
code does not require independent Git repositories.

Keep agent-config/, pi-config/, and omp-config/ as sibling components in
misty-step/harness. Preserve histories through unsquashed subtree imports and
namespace historical tags as legacy/<component>/<tag>. This is an import, not an
ongoing subtree synchronization workflow. One commit now captures a compatible
combination. No submodules or monorepo framework are required.

The root owns setup, Git hooks, verification, CI, releases, and workspace
instructions. Harness installers own runtime deployment only; they neither write
repository hooks nor accept positional arguments. Rejecting --check prevents the
old silently-deploying dry-run trap. The shared installer retains its explicit
inert --check contract.

Use one release stream, with v0.1.0 as the migration baseline. Legacy repositories
retain issues, releases, branches, and historical browsing, then become read-only
archives with destination notices. linear-cli stays independent.

Alternatives: sibling repos retain coordination and unpinned compatibility;
a submodule parent records pins but introduces a fourth repo and does not make
child changes atomic. Reconsider independence if consumers require separate
permissions or independently distributed, versioned primitives. Preserve the
component boundaries regardless of Git topology.

CI initially checks all components sequentially: these suites are cheap, and
omitting affected checks is a greater risk than their cost. Add path selection
only if measured runtime warrants it. Optional LLM release synthesis is off;
release publishing requires only the repository-scoped GitHub token.
