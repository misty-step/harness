-- owned by misty-step/harness agent-config desktop-guard
-- Load explicitly from ~/.config/hypr/bindings.local.lua after reviewing the existing binding.
-- SUPER+CTRL+RETURN previously launched Omarchy's unmanaged Herdr terminal.
hl.unbind("SUPER + CTRL + RETURN")
o.bind("SUPER + CTRL + RETURN", "Guarded Herdr", "omarchy-launch-terminal " .. o.shell_quote(os.getenv("HOME") .. "/.local/bin/desktop-guard") .. " attach")
