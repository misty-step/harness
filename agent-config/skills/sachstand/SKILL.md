---
name: sachstand
description: Orient the chief executive on where the work stands, what matters, and which decisions need them.
disable-model-invocation: true
argument-hint: "[optional scope: session, repo, initiative, or portfolio] [quiet]"
---

# Sachstand

Give the operator a tight, punchy status report. They act as chief executive. In
sixty seconds they must know where the work stands, what changed, what to keep
in mind, what they must decide, and what they need to decide it.

The brief is also spoken aloud unless the argument includes `quiet`.

This skill is read-only. Do not act on a decision until the operator chooses.
Speaking the brief is the one permitted side effect.

## Scope

The default scope is the current session and the work it touches. An argument
narrows or widens it: a repository, an initiative, a ticket, or `portfolio`.

The operator runs many sessions at once and reads each brief cold. The brief
must identify its session before anything else.

## Gather evidence first

Read primary evidence before you write. Do not ask questions.

- Conversation: the original request, commitments made, what is delivered, and
  open questions from the operator.
- Identity: the project and what it is, the task at hand, the working directory,
  the repository, the branch, and any worktree or ticket the session uses.
- Todo list, subagents, background jobs, services, and held leases.
- Git: branch, upstream state, uncommitted files, recent commits, open pull
  requests, and CI status. Separate your changes from changes someone else made.
- Work records only when the scope names them: Linear, Habitat, `USER_STORIES.md`.
- Spend or usage when it is visible.

Check each "done" claim against evidence: a test run, a merge, a deploy, or
observed output. If you did not observe it, mark it unverified. Cheap read-only
probes are fine. Do not start builds, test suites, or new work.

## Write the brief

Keep a session brief under 250 words, plus the identity block. A portfolio brief
can reach 500. Start with the identity block, then use these headings in this
order. Omit a heading only where it says so.

The identity block is three bullets:

- **Project:** name, and what it is in a few plain words
- **Task:** what this session was asked to do, in one line
- **Where:** repository path · branch · worktree or ticket if any · scope

If the session touches more than one repository, list each one on the Where
line and mark which holds the changes.

1. **Bottom line.** One or two sentences: a verdict (on track, at risk, blocked,
   or done) and the most important fact.
2. **Where we are.** The goal in one line, then the current state against it.
   Give a percentage only if you measured it.
3. **Done.** Outcomes, not activity. Attach evidence to each: commit, PR,
   command, or observation.
4. **In flight or blocked.** For each item: the owner (agent, person, or external
   party), what it waits on, and since when. Omit if nothing is open.
5. **Critical context.** Only the facts the operator must keep in mind:
   constraints, risks, deadlines, costs, surprises, and changed assumptions.
6. **Decisions needed.** For each decision:
   - the question, and why it must be decided now (cost of delay);
   - the options and the consequence of each;
   - your recommendation, and when you would choose otherwise;
   - missing information, and how to get it (a person, a command, a check).
   If nothing needs a decision, write "None." Never invent a decision.
7. **As chief executive, consider.** One to three strategic observations: scope
   drift, diminishing returns, leverage, work to stop, or a risk being accepted
   silently. Omit if you have nothing honest to say.
8. **Next.** What happens without input, and what happens after each decision.

## Style

- Bad news first. Absolute dates, not "yesterday".
- Fragments are fine. No filler, praise, or restating the request.
- Explain each ticket, system, and name in plain words the first time it appears.
- Mark inferences as `[INFERENCE]`.
- If a decision needs more than a few lines of analysis, name it and suggest
  `/skill:decide <that decision>` rather than expanding the brief.

## Speak the brief

Skip this section if the argument includes `quiet`.

After you gather evidence and before your final answer, write a spoken script
for the ear, not the eye. Keep it under 150 words, about one minute:

- Open with the project and the task in one sentence, so the listener knows
  which session is speaking. Then the verdict. Then give each decision with your
  recommendation. End with what happens next. Mention done work only as a
  count or one phrase.
- Use plain sentences. No markdown, bullets, paths, hashes, URLs, or IDs. Say a
  ticket as its plain meaning, not its key.
- Round numbers. Spell out abbreviations the listener might not know.
- Put `<short pause>` between sections. Do not write stage directions in the
  text; the voice and style are already set.

Pipe the script to [scripts/speak.ts](scripts/speak.ts). Use its absolute path
under this skill's directory:

```sh
pass-env run -e GEMINI_API_KEY=workstation/GEMINI_API_KEY -- \
  bun /absolute/skill/dir/scripts/speak.ts <<'EOF'
<spoken script>
EOF
```

Playback starts detached, and the audio is saved under `~/.cache/tts-play/`. End
the written brief with one line: the audio path, length, and cost. If the
command fails, still deliver the written brief, and state the error in that line.

Done when the operator can read the brief in sixty seconds and make every listed
decision without asking what something means.
