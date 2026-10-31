# Carries and stack landing

## Carry a verdict

A rebase or base merge carries judgment only when the stable patch-id is unchanged:

```sh
git diff <old-base>...<judged-SHA> | git patch-id --stable
git diff <new-base>...<new-head> | git patch-id --stable
```

Fetch origin first. The old base must resolve to the ledger's recorded base,
including an earlier refresh/carry; the new base must resolve to
`origin/<the change's base branch>` as
`entire trail merge <repo>/<change-number> --project <forge>/<project> --dry-run --json`
reports it, not a caller-selected branch or change-internal commit. Retarget a stacked
change before recording its carry through the
[backing PR procedure](../misty/entire.md#merge-and-forge-exceptions), discovering
the PR by branch rather than using the change number. With all four commits
available, use the helper's `record --kind head` payload:

```json
{"reason":"carry","from":"<judged-SHA>","from_base":"<old-base>","sha":"<new-head>","to_base":"<new-base>"}
```

The helper resolves full SHAs and compares patch-ids. An unresolved old base,
unrecorded base move, changed patch or conflict resolution needs re-verification
and independent judgment under the existing fix-round cap.

## Land a stack bottom-first

1. Record every change's current head once in the bottom change's trail body
   (`entire trail update --body`) before it lands. These first heads are the
   ancestry cut points for the whole stack.
2. After each merge, fetch, detach at the next change's recorded head, and move only
   its delta onto the new default branch:

   ```sh
   git fetch --prune
   git switch --detach <recorded-head>
   git rebase --onto origin/<default> <first-head-recorded-for-change-below>
   git push --force-with-lease=<branch>:<recorded-head> origin HEAD:refs/heads/<branch>
   ```

3. If the lease fails, fetch and retain the commits that moved the branch. Carry
   judgment only for an unchanged patch; otherwise re-verify under the round cap.
   Repeat from the resulting judged head with a lease pinned to that same head.
   The next change still cuts ancestry at the first head recorded for the change below.
4. Run fast affected checks at the new head, then run
   `entire trail merge <repo>/<change-number> --project <forge>/<project> --dry-run --json`.
   Confirm the dry run's change and `headSha` match the judged change and SHA.
   Only when they match and the dry run allows it, run
   `entire trail merge <repo>/<change-number> --project <forge>/<project> --json`.
