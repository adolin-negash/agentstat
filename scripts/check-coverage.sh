#!/bin/sh
set -eu

minimum=65
profile=$(mktemp)
trap 'rm -f "$profile"' EXIT
go test -coverprofile="$profile" ./backend
go tool cover -func="$profile" | awk -v minimum="$minimum" '
  $1 == "total:" {
    coverage = $3 + 0
    printf "Go coverage: %.1f%% (minimum %d%%)\n", coverage, minimum
    if (coverage < minimum) exit 1
    found = 1
  }
  END { if (!found) exit 1 }
'
