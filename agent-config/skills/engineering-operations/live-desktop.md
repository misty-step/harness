# Live desktop

The operator's session is live: windows, workspaces and focus are work in
progress, and their screen is not a test surface. Render the change off-screen
and read the framebuffer; reach the session only for what a headless render
cannot answer.

## Preview an Omarchy shell plugin

1. Render it off-screen:

   ```bash
   scripts/headless-preview.sh ~/.config/omarchy/plugins/<id>/Panel.qml /tmp/preview.png
   ```

   The script starts a headless `sway`, loads the panel through `quickshell`
   with a stand-in bar, and captures the framebuffer. It adds one Wayland socket
   beside the live one and maps no window.
   **Done when** it prints a path and `identify` reports a PNG.

2. Read the PNG. **Done when** you have looked at the card, not merely that it
   exists.

3. Read Quickshell's log when the card is blank or looks stale. The live shell
   writes to `/run/user/1000/quickshell/by-id/*/log.qslog`; its stdout is a
   socket, so `console.log` never reaches `journalctl`.

The harness answers layout, type and data rendering against the machine's real
readings. It cannot answer placement against the real bar, because the stand-in
bar has its own geometry. Report what you verified off-screen, then ask the
operator for the one look that needs the real bar.

## Stale instances

Saving under `~/.config/omarchy/plugins/` refreshes the bar widget. An
**already-open popup keeps the instance it opened with**, so the panel on screen
can be several edits behind the file, and a correct fix reads as a broken one.
Close and reopen the panel after a change; restart the shell
(`omarchy restart shell`) only when the bar widget itself is stale.
**Done when** the visible text matches the file you just wrote.

## Reaching the live session

Ask the operator to summon the panel and describe or capture it. Switching their
workspace or screenshotting their screen is theirs to grant, not a step in a
verification recipe.
