#!/bin/sh
# Copies the canonical skill into each implementation's package, so agents in projects that install mbse-patterns
# find it next to the code. SKL-01 checks that the copies are current.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
for target in "$here/../python3/mbse/Patterns/skill" "$here/../typescript5/skill"; do
  rm -rf "$target"
  mkdir -p "$target"
  cp -R "$here/mbse-patterns/." "$target/"
done
