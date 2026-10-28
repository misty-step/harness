"""Recognize exact pre-marker harness packages for a safe canonical upgrade.

Fingerprints are from maintained source history, not a name-based ownership claim.
Source commits: 26c306f163cb0e02afff3d86db136e76dcd75fbc (heartbeat),
ec4229babb201bb5180844ae1bb3a45c9d89fb2a (lage).
"""
import hashlib
from pathlib import Path
import sys

PACKAGES = {'heartbeat': {'SKILL.md': '4fd5d5def08cbfe953e632e744abc67fe48d9cacfb18d916464327dc39326056'}, 'lage': {'self-check.md': 'f5ef7aae17ffc8a327203beb7a5b46ffdf9d1c7ffcfa070acef95cf2a47b8640', 'SKILL.md': '739f9e2789ac269c8fcfdd8f8c9b8c4cbdb6c4984cb58a3eba32a6ef41fc6fdd'}}


def owns_legacy_skill(path: Path) -> bool:
    expected = PACKAGES.get(path.name)
    if expected is None or path.is_symlink() or not path.is_dir():
        return False
    actual = {}
    for item in path.rglob("*"):
        if item.is_symlink() or not (item.is_dir() or item.is_file()):
            return False
        if item.is_file():
            actual[str(item.relative_to(path))] = hashlib.sha256(item.read_bytes()).hexdigest()
    return actual == expected


if __name__ == "__main__":
    raise SystemExit(0 if owns_legacy_skill(Path(sys.argv[1])) else 1)
