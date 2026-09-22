# Stories

<!-- Root artifact: what users must be able to do. One file, ids never
reused, criteria a check can fail on. skill://user-stories guides edits. -->

## Capability: <name>

## US-001 <capability sentence>

Statement: When I <situation>, I want <progress>, so I can <outcome>.

Criteria:
1. WHEN <trigger>, THE SYSTEM SHALL <exact behavior>.
2. IF <error condition>, THE SYSTEM SHALL <exact behavior>.

No-gos: <what this story will not grow into>

Evidence: <paths or commands that prove the criteria>

<!-- Example — replace with the real story. -->

## US-002 See a project's change trend

Statement: When I open a project page, I want its change trend for the
selected window, so I can see if it is moving more or less.

Criteria:
1. WHEN I open a project page with a seven-day window, THE SYSTEM SHALL show
   its change total compared with the prior seven-day window.
2. IF a comparison window lacks coverage, THE SYSTEM SHALL show the
   comparison as unavailable, not as a zero.

No-gos: no generated health scores for this trend.

Evidence: `internal/web/engineering_test.go`
