---
name: heartbeat
description: Check assigned work for stalls, dropped decisions and failed recovery. Use for /heartbeat or "Heartbeat sweep".
---

# Heartbeat

Follow global guidance's **Autonomy** section. Inspect the work named by the user or by this automation's saved prompt. Discovery does not expand that scope.

## Sweep

Use the host's native chat tools to list the assigned chats, read their latest status and inspect older context only when a blocker or question remains unclear. Use native collaboration status for children of the current task. Prefer compact wait/status snapshots to repeated full-history reads. Preserve existing schedules and bindings.

For each assigned item:

- Read its goal, latest verified outcome, next step and pending questions. Confirm referenced PR states with GitHub.
- Relay an existing decision with its source. Leave technical choices with the task doing the work.
- Distinguish a provider limit from authentication, infrastructure or context failures. Native usage-limit readings or `upkeep room --json`, when available, establish current account room; missing readings are unknown. Leave native automatic recovery running.
- Continue authorized unblocked work. For a demonstrably lost child of the current task, stop that child before replacing it through native collaboration tools. Keep the replacement within the same scope and carry its context and evidence forward.
- Follow up with another chat only when the user authorized messaging it. Read its current state before sending and avoid duplicate nudges. A failed read is unknown, not evidence of a stall.
- Report a persistent blocker with its exact error, last useful progress and the owner who can resolve it. A lack of recent pushes alone does not prove a stall.

Do not open independent chats or create new schedules as part of a sweep. Those are separate user requests.

## Report

Compare with the previous sweep and avoid repeating unchanged findings. Notify only on a meaningful change, completion, failure or required user action unless the saved prompt explicitly asks for periodic reports. With no news, stay quiet.

Deliver a changed digest through `home post --from Heartbeat`, Markdown on stdin, and report completed actions in the current chat. Deduplicate against the prior sweep and inbox before posting. Link each referenced PR, issue and chat with a one-line summary. Questions state the options, recommendation and consequence of waiting. Report actions actually completed and the next check when one is scheduled.
