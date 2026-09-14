#!/usr/bin/env python3
"""Validate and package the Bedrock behavior/resource packs into one .mcaddon."""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKS = ("AIPlayers_BP", "AIPlayers_RP")
OUTPUT_NAME = "AI-Players-Bedrock.mcaddon"
FIXED_TIME = (2026, 1, 1, 0, 0, 0)


def validate_json() -> None:
    failures: list[str] = []
    for pack in PACKS:
        manifest = ROOT / pack / "manifest.json"
        if not manifest.is_file():
            failures.append(f"missing {manifest.relative_to(ROOT)}")
        for path in sorted((ROOT / pack).rglob("*.json")):
            try:
                json.loads(path.read_text(encoding="utf-8"))
            except Exception as exc:  # noqa: BLE001
                failures.append(f"{path.relative_to(ROOT)}: {exc}")
    if failures:
        raise SystemExit("JSON validation failed:\n" + "\n".join(failures))


def write_zip(source: Path, destination: Path) -> None:
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(source.rglob("*")):
            if not path.is_file():
                continue
            info = zipfile.ZipInfo(path.relative_to(source).as_posix(), FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, path.read_bytes())


def build(output_dir: Path) -> Path:
    validate_json()
    output_dir.mkdir(parents=True, exist_ok=True)
    work = output_dir / ".packs"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir()

    mcpack_paths: list[Path] = []
    for pack in PACKS:
        mcpack = work / f"{pack}.mcpack"
        write_zip(ROOT / pack, mcpack)
        mcpack_paths.append(mcpack)

    target = output_dir / OUTPUT_NAME
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as addon:
        for mcpack in mcpack_paths:
            info = zipfile.ZipInfo(mcpack.name, FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            addon.writestr(info, mcpack.read_bytes())

    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix(target.suffix + ".sha256").write_text(
        f"{digest}  {target.name}\n", encoding="utf-8"
    )
    shutil.rmtree(work)
    return target


if __name__ == "__main__":
    destination = ROOT / (sys.argv[1] if len(sys.argv) > 1 else "dist")
    result = build(destination)
    print(f"Built {result.relative_to(ROOT)} ({result.stat().st_size} bytes)")
