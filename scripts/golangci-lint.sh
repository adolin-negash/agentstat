#!/bin/sh
set -eu

version=v2.14.0
release=${version#v}
project_root=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
tools_dir=${AGENTSTAT_TOOLS_DIR:-"$project_root/.tools"}
binary="$tools_dir/golangci-lint-$release/golangci-lint"
GOCACHE=${GOCACHE:-"$project_root/.tools/go-build-cache"}
GOLANGCI_LINT_CACHE=${GOLANGCI_LINT_CACHE:-"$project_root/.tools/golangci-cache"}
export GOCACHE GOLANGCI_LINT_CACHE

matches_version() {
  case "$("$1" version 2>/dev/null || true)" in
    *"version $release "*) return 0 ;;
    *) return 1 ;;
  esac
}

if command -v golangci-lint >/dev/null 2>&1 && matches_version golangci-lint; then
  exec golangci-lint "$@"
fi
if [ -x "$binary" ] && matches_version "$binary"; then
  exec "$binary" "$@"
fi

os=$(go env GOOS)
arch=$(go env GOARCH)
case "$os/$arch" in
  darwin/amd64|darwin/arm64|linux/amd64|linux/arm64) ;;
  *) echo "golangci-lint $version has no supported bootstrap for $os/$arch" >&2; exit 1 ;;
esac

archive="golangci-lint-$release-$os-$arch.tar.gz"
base_url="https://github.com/golangci/golangci-lint/releases/download/$version"
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM

echo "Downloading golangci-lint $version for $os/$arch..."
curl -fsSL --retry 3 "$base_url/$archive" -o "$temporary/$archive"
curl -fsSL --retry 3 "$base_url/golangci-lint-$release-checksums.txt" -o "$temporary/checksums.txt"
expected=$(awk -v archive="$archive" '$2 == archive || $2 == "*" archive { print $1; exit }' "$temporary/checksums.txt")
if [ -z "$expected" ]; then
  echo "No checksum found for $archive" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$temporary/$archive" | awk '{ print $1 }')
else
  actual=$(shasum -a 256 "$temporary/$archive" | awk '{ print $1 }')
fi
if [ "$actual" != "$expected" ]; then
  echo "Checksum mismatch for $archive" >&2
  exit 1
fi

tar -xzf "$temporary/$archive" -C "$temporary" "golangci-lint-$release-$os-$arch/golangci-lint"
mkdir -p "$(dirname "$binary")"
install -m 755 "$temporary/golangci-lint-$release-$os-$arch/golangci-lint" "$binary"
exec "$binary" "$@"
