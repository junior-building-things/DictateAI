#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <version> <tag>" >&2
  exit 1
fi

version="$1"
tag="$2"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bundle_root="$repo_root/src-tauri/target/aarch64-apple-darwin/release/bundle"
macos_dir="$bundle_root/macos"
app_name="DictateAI"
app_bundle="$macos_dir/$app_name.app"
updater_tar="$macos_dir/$app_name.app.tar.gz"
sig_path="$updater_tar.sig"
manifest_path="$bundle_root/latest.json"

if [[ ! -d "$app_bundle" ]]; then
  echo "missing app bundle at $app_bundle" >&2
  exit 1
fi

rm -f "$updater_tar" "$sig_path" "$manifest_path"
tar -C "$macos_dir" -czf "$updater_tar" "$app_name.app"

(
  cd "$repo_root"
  npm run tauri signer sign -- "$updater_tar"
)

signature="$(tr -d '\n' < "$sig_path")"
download_url="https://github.com/junior-building-things/DictateAI/releases/download/$tag/$(basename "$updater_tar")"
pub_date="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

cat > "$manifest_path" <<EOF
{
  "version": "$version",
  "pub_date": "$pub_date",
  "url": "$download_url",
  "signature": "$signature",
  "notes": "Signed updater artifacts for DictateAI."
}
EOF

echo "Created updater artifacts:"
echo "  $updater_tar"
echo "  $sig_path"
echo "  $manifest_path"
