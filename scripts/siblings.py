#!/usr/bin/env python3
"""The mbse repositories this one depends on, beside it as sibling checkouts (see siblings.json).

The tool lives in mbse-schemas, as `scripts/siblings.py`, whose docstring describes its commands
(`python3 scripts/siblings.py help`); this runs it for this repository. If mbse-schemas is missing, it is cloned first,
at the commit siblings.json pins. Standard library only, so that it runs before anything is installed.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMAS = ROOT.parent / "mbse-schemas"
TOOL = SCHEMAS / "scripts" / "siblings.py"

if not SCHEMAS.exists():
    entry = json.loads((ROOT / "siblings.json").read_text())["mbse-schemas"]
    target = entry.get("commit") or f"v{entry['version']}"
    subprocess.run(["git", "clone", "--quiet", entry["repository"], str(SCHEMAS)], check=True)
    subprocess.run(["git", "-C", str(SCHEMAS), "checkout", "--quiet", "--detach", target], check=True)
    print(f"mbse-schemas: cloned at {target[:7] if entry.get('commit') else target}")
if not TOOL.is_file():
    raise SystemExit(f"{TOOL} is missing: mbse-schemas is older than the tool; update it")
sys.dont_write_bytecode = True  # a sibling stays clean, as check --strict requires
spec = importlib.util.spec_from_file_location("siblings", TOOL)
assert spec is not None and spec.loader is not None
siblings = importlib.util.module_from_spec(spec)
spec.loader.exec_module(siblings)
sys.exit(siblings.main(ROOT, sys.argv[1:]))
