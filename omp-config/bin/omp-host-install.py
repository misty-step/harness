#!/usr/bin/env python3
# owned by misty-step/harness omp-config host-install
"""Transport for Workbench's fixed, audited host installation recipes."""

import argparse
import json
import os
from pathlib import Path
import pwd
import re
import socket
import stat
import struct
import sys
import time

MAX_REQUEST = 64 * 1024
MAX_REPLY = 8 * 1024 * 1024
TIMEOUT = 900
REPLY_FIELDS = {"schema_version", "ok", "receipt", "error", "capabilities"}


class InstallError(Exception):
    pass


def safe_name(value):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,199}", value):
        raise argparse.ArgumentTypeError("expected a safe single name, not a path")
    return value


def item_name(value):
    value = safe_name(value)
    if not value.startswith("K-"):
        raise argparse.ArgumentTypeError("expected an existing Glass item ID starting K-")
    return value


def revision(value):
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise argparse.ArgumentTypeError("revision must be exactly 40 lowercase hexadecimal characters")
    return value


def arguments(argv):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--socket", type=Path,
                        default=Path(pwd.getpwuid(os.getuid()).pw_dir) / ".local/lib/workbench-host-install/route.sock",
                        help="absolute socket override for disposable smoke tests only")
    actions = parser.add_subparsers(dest="operation", required=True)
    actions.add_parser("capabilities", allow_abbrev=False)
    install = actions.add_parser("install", allow_abbrev=False)
    install.add_argument("--item", required=True, type=item_name)
    install.add_argument("--recipe", required=True,
                         choices=("workbench-item", "harness-cli", "shared-skill", "shared-bin"))
    install.add_argument("--revision", required=True, type=revision)
    install.add_argument("--selection", required=True, type=safe_name)
    install.add_argument("--profile", choices=("omp", "kaylee"), default="omp")
    for operation in ("readback", "rollback"):
        action = actions.add_parser(operation, allow_abbrev=False)
        action.add_argument("receipt_id", type=safe_name)
    args = parser.parse_args(argv)
    if args.operation == "install":
        if args.profile != "omp" and args.recipe != "shared-skill":
            parser.error("only shared-skill may target the kaylee profile")
        if args.recipe == "harness-cli" and args.selection != "cli":
            parser.error("harness-cli requires --selection cli")
    return args


def request_for(args):
    request = {"schema_version": 1, "operation": args.operation}
    if args.operation == "install":
        request.update({key: getattr(args, key)
                        for key in ("item", "recipe", "revision", "selection", "profile")})
    elif args.operation in ("readback", "rollback"):
        request["receipt_id"] = args.receipt_id
    return request


def validate_socket(path):
    if not path.is_absolute():
        raise InstallError("host install requires an absolute socket path")
    info = path.lstat()
    if (not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != 0o600):
        raise InstallError("host install requires a UID-owned Unix socket with mode 0600")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise InstallError("duplicate field in host install response")
        result[key] = value
    return result


def invalid_constant(value):
    raise InstallError(f"invalid JSON constant in host install response: {value}")


def validate_reply(raw, operation):
    try:
        reply = json.loads(raw, object_pairs_hook=unique_object, parse_constant=invalid_constant)
    except (ValueError, RecursionError) as exc:
        raise InstallError("invalid JSON host install response") from exc
    if (not isinstance(reply, dict) or set(reply) != REPLY_FIELDS
            or type(reply["schema_version"]) is not int or reply["schema_version"] != 1
            or type(reply["ok"]) is not bool
            or not (reply["receipt"] is None or isinstance(reply["receipt"], dict))
            or not (reply["capabilities"] is None or isinstance(reply["capabilities"], dict))):
        raise InstallError("invalid host install response envelope")
    if reply["ok"]:
        payload = "capabilities" if operation == "capabilities" else "receipt"
        unused = "receipt" if operation == "capabilities" else "capabilities"
        if reply["error"] is not None or not isinstance(reply[payload], dict) or reply[unused] is not None:
            raise InstallError("host install success response does not match the requested action")
    elif not isinstance(reply["error"], str) or not reply["error"].strip():
        raise InstallError("host install failure response has no error")
    return reply


def exchange(path, request):
    validate_socket(path)
    wire = json.dumps(request, separators=(",", ":"), allow_nan=False).encode() + b"\n"
    if len(wire) > MAX_REQUEST:
        raise InstallError("host install request exceeds 64 KiB")
    deadline = time.monotonic() + TIMEOUT
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(TIMEOUT)
        connection.connect(str(path))
        peer = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
        if struct.unpack("3i", peer)[1] != os.getuid():
            raise InstallError("host install socket peer has the wrong UID")
        connection.sendall(wire)
        connection.shutdown(socket.SHUT_WR)
        data = bytearray()
        newline = False
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise InstallError("host install response timed out")
            connection.settimeout(remaining)
            block = connection.recv(min(65536, MAX_REPLY - len(data) + 1))
            if not block:
                if not newline:
                    raise InstallError("incomplete host install response")
                return validate_reply(bytes(data[:-1]), request["operation"])
            if newline:
                raise InstallError("unexpected trailing host install response data")
            if len(data) + len(block) > MAX_REPLY:
                raise InstallError("host install response exceeds 8 MiB")
            index = block.find(b"\n")
            if index >= 0:
                if index != len(block) - 1:
                    raise InstallError("unexpected trailing host install response data")
                newline = True
            data.extend(block)


def main(argv):
    args = arguments(argv)
    try:
        reply = exchange(args.socket, request_for(args))
    except (InstallError, OSError, ValueError) as exc:
        print(f"omp-host-install: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(reply, separators=(",", ":"), allow_nan=False))
    return 0 if reply["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
