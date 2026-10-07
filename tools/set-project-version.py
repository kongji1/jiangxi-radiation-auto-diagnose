"""Advance the manifest version and regenerate; retain runtime history values."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = "jiangxi-radiation-auto-diagnose.user.js"
FILES = ("src/manifest.json", "PROJECT_STATE.json", OUTPUT)
VERSION = re.compile(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\Z")


class VersionError(RuntimeError):
    pass


def canonical_version(value):
    if not isinstance(value, str) or not VERSION.fullmatch(value):
        raise VersionError("Version must be canonical major.minor.patch")
    return tuple(int(part) for part in value.split("."))


def safe_root(value):
    path = Path(value).absolute()
    if path.is_symlink() or not path.is_dir():
        raise VersionError("Project root must be a real directory")
    actual = path.resolve()
    if actual != path:
        raise VersionError("Project root may not follow a symbolic link")
    return actual


def safe_file(root, relative):
    path = root / relative
    current = path
    while current != root:
        if current.is_symlink():
            raise VersionError("Project files may not follow a symbolic link")
        current = current.parent
    if not path.is_file() or not path.resolve().is_relative_to(root):
        raise VersionError("Required project file is missing or outside the root")
    if path.stat().st_nlink > 1:
        raise VersionError("Project files may not have multiple hard links")
    return path


def execute(argv, root):
    try:
        process = subprocess.run(argv, cwd=root, capture_output=True, timeout=30)
        return process.returncode
    except (OSError, subprocess.TimeoutExpired):
        return -1


def atomic_bytes(path, body):
    fd, temporary = tempfile.mkstemp(prefix=".version-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def json_bytes(value, original):
    newline = "\r\n" if b"\r\n" in original else "\n"
    text = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    return text.replace("\n", newline).encode("utf-8")


def set_version(target, root=ROOT, dry_run=False, run=execute):
    start = time.monotonic()
    target_parts = canonical_version(target)
    root = safe_root(root)
    paths = {name: safe_file(root, name) for name in FILES}
    safe_file(root, "tools/build-userscript.mjs")
    original = {name: path.read_bytes() for name, path in paths.items()}
    try:
        manifest = json.loads(original["src/manifest.json"].decode("utf-8"))
        state = json.loads(original["PROJECT_STATE.json"].decode("utf-8"))
    except (ValueError, UnicodeError):
        raise VersionError("Manifest or project state is invalid UTF-8 JSON") from None
    if not isinstance(manifest, dict) or not isinstance(state, dict):
        raise VersionError("Manifest and project state must be JSON objects")
    current = manifest.get("version")
    current_parts = canonical_version(current)
    if manifest.get("versionToken") != "{{SCRIPT_VERSION}}" or manifest.get("output") != OUTPUT:
        raise VersionError("Manifest must own the two generated version tokens")
    if state.get("version") != current:
        raise VersionError("Project state version differs from the manifest")
    if target_parts < current_parts:
        raise VersionError("Version downgrade is not allowed")
    build = ["node", "tools/build-userscript.mjs"]
    if run(build + ["--check"], root) != 0:
        raise VersionError("Current generated userscript fails the build check")
    # A concurrent edit during the read-only check must not be overwritten.
    if any(safe_file(root, name).read_bytes() != body for name, body in original.items()):
        raise VersionError("Project changed during version preflight")
    common = {"previousVersion": current, "version": target,
              "runtimeHistoryChanged": False, "publishedMetadataChanged": False}
    if target == current or dry_run:
        return {**common, "readiness": "NO_CHANGE" if target == current else "DRY_RUN",
                "written": False, "elapsedMs": round((time.monotonic() - start) * 1000)}
    manifest["version"] = target
    state["version"] = target
    try:
        atomic_bytes(paths["src/manifest.json"], json_bytes(manifest, original["src/manifest.json"]))
        atomic_bytes(paths["PROJECT_STATE.json"], json_bytes(state, original["PROJECT_STATE.json"]))
        if run(build + ["--write"], root) != 0 or run(build + ["--check"], root) != 0:
            raise VersionError("New userscript failed to build; original files restored")
        for name in FILES:
            safe_file(root, name)
        generated = paths[OUTPUT].read_text(encoding="utf-8")
        metadata = re.findall(r"^//\s*@version\s+(\S+)\s*$", generated, re.M)
        runtime = re.findall(r"^\s*const\s+SCRIPT_VERSION\s*=\s*['\"]([^'\"]+)['\"]\s*;", generated, re.M)
        if metadata != [target] or runtime != [target]:
            raise VersionError("Generated metadata/runtime version mismatch; original files restored")
    except Exception:
        for name, body in original.items():
            # Replace each original directory entry without following a file link.
            if paths[name].parent.resolve().is_relative_to(root):
                atomic_bytes(paths[name], body)
        raise
    return {**common, "readiness": "VERSION_UPDATED", "written": True,
            "sourceSha256Lf": hashlib.sha256(generated.replace("\r\n", "\n").encode("utf-8")).hexdigest(),
            "elapsedMs": round((time.monotonic() - start) * 1000)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--to", required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--root", default=str(ROOT))
    args = parser.parse_args(argv)
    try:
        value = set_version(args.to, args.root, args.dry_run)
        print(json.dumps(value, ensure_ascii=False))
        return 0
    except (VersionError, OSError) as error:
        reason = str(error) if isinstance(error, VersionError) else type(error).__name__
        print(json.dumps({"readiness": "VERSION_FAILED", "ok": False, "reason": reason}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
