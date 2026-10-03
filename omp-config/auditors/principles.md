# Principles audit

Question: did the last seven days of changes follow the five principles?

The bundle lists the PRs merged in the window with their bodies and comments,
plus deploy runs, release failures and incident tickets. Judge the practice,
not the capability; a missing capability belongs to the Foundations audit.

1. **Reproduce before trusting**: merged changes that touched behaviour carry
   evidence of a walk on the running product, such as preview screenshots,
   video or walk output.
2. **Only proven changes**: releases shipped a proven head; failed deploys
   rolled back, or were restored before anyone investigated.
3. **Lost promise, owned repair**: every red default-branch check, failed
   deploy and incident in the window has an owning ticket.
4. **Every check earns its keep**: checks added in the window name the failure
   they prevent; checks that only failed, or only passed, are named.
5. **Ticket to packet**: each change cites its ticket, and its ticket the
   story or spec; a packet of brief, session and proof exists.

File patterns, not one ticket per PR: one ticket per principle the repository
broke more than once, with the PRs or runs as evidence. A single serious
breach, such as an unproven change that altered access or data, gets its own
ticket.
