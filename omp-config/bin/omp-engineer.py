#!/usr/bin/env python3
# owned by misty-step/harness omp-config engineer-cage
"""Launch native OMP with the desktop boundary, without resource admission."""

import importlib.util
from importlib.machinery import SourceFileLoader
import os
from pathlib import Path
import pwd
import sys


def native_arguments(argv):
    values = {"--cwd", "--config", "--add-dir", "--mode", "--fork", "--provider", "--model",
              "--smol", "--slow", "--plan", "--prewalk-into", "--plan-yolo-into",
              "--max-time", "--service-tier", "--api-key", "--system-prompt",
              "--system-prompt-template", "--append-system-prompt", "--provider-session-id",
              "--prompt-cache-key", "--session-dir", "--models", "--tools", "--thinking",
              "--hook", "--extension", "-e", "--trusted-extension", "--plugin-dir",
              "--skills", "--approval-mode", "--profile", "--alias", "--export"}
    optional = {"--resume", "-r", "--session"}
    booleans = {"--help", "--version", "--allow-home", "--continue", "--from-claude",
                "--from-codex", "--no-session", "--no-tools", "--no-lsp", "--no-pty",
                "--hide-thinking", "--advisor", "--external-thinking", "--prewalk",
                "--no-prewalk", "--plan-yolo", "--print", "--print-thoughts",
                "--no-extensions", "--no-skills", "--no-rules", "--no-title", "--no-ui",
                "--auto-approve", "--yolo"}
    index = 0
    while index < len(argv):
        arg = argv[index]
        yield index, arg
        if arg == "--":
            return
        flag, equals, _ = arg.partition("=") if arg.startswith("--") else (arg, "", "")
        if arg.startswith("-") and not equals and index + 1 < len(argv):
            following = argv[index + 1]
            if flag in values or (not following.startswith("-") and (
                    (flag in optional and following != "") or (flag.startswith("--") and flag not in booleans))):
                index += 1
        index += 1


def native_command_index(argv):
    commands = {"launch", "help", "acp", "agents", "auth-broker", "auth-gateway", "bench", "browser-relay",
                "cleanse", "clip", "collab", "commit", "completions", "__complete", "compress", "config",
                "dry-balance", "find", "gallery", "gc", "git", "grep", "grievances",
                "if-bench", "images", "img", "install", "join", "login", "models", "play", "plugin",
                "plugins", "predict", "ps", "read", "render", "say", "search", "q", "web-search",
                "setup", "share", "shell", "skill", "skills", "ssh", "stats", "stream",
                "tiny-models", "token", "toks", "ttsr", "update", "usage", "worktree", "wt"}
    for index, arg in native_arguments(argv):
        if arg == "--":
            return None
        if not arg.startswith("-"):
            return index if arg in commands else None
    return None


def display_invocation(argv):
    command = native_command_index(argv)
    administration = {"help", "auth-broker", "auth-gateway", "browser-relay",
                      "completions", "__complete", "config", "gc", "install", "login",
                      "models", "plugin", "plugins", "ps", "setup", "skill", "skills",
                      "ssh", "stats", "tiny-models", "token", "toks", "ttsr", "update",
                      "usage", "worktree", "wt"}
    if command is not None and argv[command] in administration:
        return False
    for _, arg in native_arguments(argv):
        if arg == "--":
            break
        if arg.split("=", 1)[0] in ("-h", "--help", "-v", "--version", "--export", "--alias"):
            return False
    return True


def launch(argv):
    native = Path(pwd.getpwuid(os.getuid()).pw_dir) / ".local/lib/omp-engineer/omp"
    environment = dict(os.environ)
    command_index = native_command_index(argv)
    if command_index is not None and argv[command_index] == "update":
        environment["PATH"] = str(native.parent) + os.pathsep + environment.get("PATH", "")
    command = [str(native), *argv]
    if display_invocation(argv):
        directory = Path(__file__).resolve().parent
        boundary = directory / ("omp-display.py" if Path(__file__).suffix == ".py" else "omp-display")
        loader = SourceFileLoader("omp_display", str(boundary))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        module = importlib.util.module_from_spec(spec)
        loader.exec_module(module)
        if not module.isolated():
            command = ["/usr/bin/python3", str(boundary), "--", *command]
    os.execve(command[0], command, environment)


def main(argv):
    if Path(sys.argv[0]).name != "omp":
        if argv in (["--help"], ["-h"]):
            print("Usage: omp-engineer [--] OMP-ARGUMENTS...\nNative OMP with private desktop isolation; no memory or ticket admission.")
            return 0
        if argv[:1] == ["--"]:
            argv = argv[1:]
    launch(argv)


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (OSError, ImportError) as exc:
        print(f"omp-engineer: {exc}", file=sys.stderr)
        sys.exit(1)
