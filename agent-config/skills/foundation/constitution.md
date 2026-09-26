# Foundations

## Build less, and build it well

- **Every change is necessary, small and clean, and fixes the real problem instead of hiding it.**
  Get the data and its relationships right first, then write the least that
  works. Review flags hacks, sprawl, leftover paths and unrelated edits.
- **Each part has a small, simple face and keeps its complexity inside.**
  Never push special cases, thin wrappers or internals onto callers, users or
  whoever runs the system. Review flags complexity that spreads.
- **Things that change for different reasons stay apart, and every piece of data has one owner.**
  Compose simple parts, keep only necessary complexity, and give each piece of
  state one owner and one path. Review flags braided concerns.
- **Deleting is the first move and often the best one.**
  Question the requirement, delete, simplify what is left, and only then speed
  it up or automate it. Effort already spent is no reason to keep anything. A
  replacement removes the old path in the same change.
- **We build small, focused apps that fit in one agent's head.**
  Aim for under 100,000 lines, ideally under 50,000. Prefer a small tool to a
  growing framework.

## Know what we are building

- **Every product writes down what its users, agents included, must be able to do, in words a check can fail.**
  Only Phaedrus changes what a product is for. A change that touches a story's
  code cites that story, and a check confirms it.
- **Decisions that are hard to reverse, surprising, and real trade-offs are written down when they are made.**
  The record keeps the why and is never rewritten to describe the present.
- **Every fact has one home, and everything else points to it.**
  Facts in code or configuration are never copied into prose. A product's own
  rules live in its invariants list, each naming the check that enforces it or
  left for reviewers to judge.

## Agents can run it, drive it and prove it

- **Every project is easy for an agent to work on and hard for an agent to break.**
  Strict gates and strict types turn whole classes of mistakes into failed
  builds. One command runs the whole gate on every change.
- **Anyone, including an agent, can set up, run and drive the product from scratch without a human step.**
  A setup script needs no credentials, and a written procedure launches the
  product, drives the core journey, captures evidence and cleans up. Everything
  is managed through code, a command line or an API, never a sign-up form or a
  dashboard.
- **Agents walk every user story through the real product, on every change that touches it and every night.**
  Each walk leaves evidence tied to the exact version. A story nobody can walk
  yet is a dated, owned gap and never counts as proof. A failed nightly walk
  opens an owned issue.
- **Tests prove what users can observe, not how the code is wired.**
  Few mocks, no tests of plumbing, high coverage, and property or mutation
  tests where they pay. Review flags tests that cannot fail.
- **Every change is reviewed by someone other than its author, against these principles, the product's own rules and the story it serves.**
  Reviewers bring different models and perspectives. Findings cite the rule or
  story. Review advises; checks decide.
- **Secrets never enter the code, dependencies stay current, and every app tests who may do what.**
  The gate scans for secrets, a bot's safe dependency updates merge on green,
  and tests cover permission boundaries.

## Ship continuously

- **Green on the main branch goes to production for every tenant, with no hand step.**
  The gate is strong enough to ship at 5pm on a Friday. Each tenant's
  migrations run first and stay compatible with the running code. An excluded
  tenant is named with a reason. After every deploy, each tenant's version is
  read back.
- **When a release goes wrong we roll it back first and investigate second, and we have practised the rollback.**
  A recorded rollback drill proves the way back works.

## Watch it run, and learn from every failure

- **A running product explains itself: every important step and failure leaves a structured record we can search.**
  Errors keep their cause, release and environment. Secrets and user content
  never leave the product. Telemetry trouble never breaks it.
- **When production breaks it is loud, and the alert goes to an agent, never to a person's inbox or phone.**
  Sentry or an approved equivalent, plus outside health checks, alert only the
  agent triage intake. Triage escalates to Kaylee only when the alert is real.
  A deliberate failure proves the path.
- **Every incident ends with its whole class of error made impossible, not just this case fixed.**
  The incident gets a ticket, a postmortem, a structural fix, and a test that
  would catch a repeat. The ticket closes only when the fix and the test are
  linked.
- **We fix mistakes by making them impossible, never by adding a warning.**
  Make the wrong value unrepresentable, give the state one owner, remove the
  dangerous option, or add a check that refuses the mistake. Findings a machine
  can decide become checks.

## Keep ourselves honest

- **Anything that matters is enforced by a check that can fail, not by a written instruction.**
  Being late means a dated, owned gap that expires, never an open promise.
- **Nothing is called done, safe or working without evidence from the real system.**
  A config file, an installed library or a green unit test is not proof.
  Evidence names the exact version and what it did not cover.
- **Every part of building software runs all the time, with agents doing the work and Phaedrus setting direction.**
  Agents groom, build, test, review, monitor, keep standards current and close
  gaps. Phaedrus decides intent and approves new foundations.
