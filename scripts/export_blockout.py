#!/usr/bin/env python3
"""Simple asset export template for modern blockout workflows.

This script intentionally avoids legacy THPS/THUG import logic and focuses on
standard mesh sources such as .fbx, .gltf, and .glb.
"""

from __future__ import annotations

import argparse
from pathlib import Path

SUPPORTED_EXTENSIONS = {".fbx", ".gltf", ".glb", ".obj"}


def find_assets(root: Path, extensions: set[str]) -> list[Path]:
    matches: list[Path] = []
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix.lower() in extensions:
            matches.append(path)
    return matches


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Scan a blockout directory and prepare a modern asset import list."
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("content/blockouts"),
        help="Directory to scan for standard mesh files.",
    )
    parser.add_argument(
        "--dest",
        type=Path,
        default=Path("assets/models"),
        help="Destination directory for organized outputs.",
    )
    parser.add_argument(
        "--extensions",
        nargs="*",
        default=[".fbx", ".gltf", ".glb", ".obj"],
        help="File extensions to include.",
    )
    args = parser.parse_args()

    extensions = {item.lower() for item in args.extensions}
    source_root = args.source
    dest_root = args.dest

    if not source_root.exists():
        raise SystemExit(f"Source directory does not exist: {source_root}")

    files = find_assets(source_root, extensions)
    dest_root.mkdir(parents=True, exist_ok=True)

    print(f"Scanning: {source_root}")
    print(f"Output:   {dest_root}")
    print(f"Found {len(files)} standard asset file(s).")

    for file in files:
        relative = file.relative_to(source_root)
        target = dest_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        print(f"- {relative} -> {target}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
