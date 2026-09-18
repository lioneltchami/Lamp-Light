#!/usr/bin/env bash
# Update lioneltchami/homebrew-tap Casks/lamp-light.rb for a released version.
# Usage: update-homebrew-cask.sh <version> <arm64_sha256> <intel_sha256>
# Env: HOMEBREW_TAP_DEPLOY_KEY (SSH private key) OR push access via existing git remote.
set -euo pipefail

VERSION="${1:?version required (e.g. 1.2.17)}"
ARM_SHA="${2:?arm64 sha256 required}"
INTEL_SHA="${3:?intel sha256 required}"
TAP_REPO="${TAP_REPO:-lioneltchami/homebrew-tap}"
CASK_PATH="Casks/lamp-light.rb"
WORKDIR="$(mktemp -d)"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

if [ -n "${HOMEBREW_TAP_DEPLOY_KEY:-}" ]; then
  KEY_FILE="$WORKDIR/deploy_key"
  umask 077
  # Multiline secret from GitHub Actions — write bytes as-is.
  printenv HOMEBREW_TAP_DEPLOY_KEY > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  # OpenSSH requires a trailing newline.
  [[ $(tail -c1 "$KEY_FILE" | wc -l) -eq 0 ]] && echo >> "$KEY_FILE"
  export GIT_SSH_COMMAND="ssh -i $KEY_FILE -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  git clone --depth 1 "git@github.com:${TAP_REPO}.git" "$WORKDIR/tap"
else
  git clone --depth 1 "https://github.com/${TAP_REPO}.git" "$WORKDIR/tap"
fi

cd "$WORKDIR/tap"
test -f "$CASK_PATH"

python3 - "$CASK_PATH" "$VERSION" "$ARM_SHA" "$INTEL_SHA" <<'PY'
import re, sys
path, version, arm, intel = sys.argv[1:5]
text = open(path).read()
text2, n = re.subn(
    r'version\s+"[^"]+"',
    f'version "{version}"',
    text,
    count=1,
)
if n != 1:
    raise SystemExit("version stanza not found")
text2, n = re.subn(
    r'sha256\s+arm:\s+"[a-f0-9]+",\s*\n\s*intel:\s+"[a-f0-9]+"',
    f'sha256 arm:   "{arm}",\n         intel: "{intel}"',
    text2,
    count=1,
)
if n != 1:
    raise SystemExit("sha256 stanza not found")
open(path, "w").write(text2)
print(f"Updated {path} → {version}")
PY

if git diff --quiet -- "$CASK_PATH"; then
  echo "Cask already at $VERSION — nothing to commit"
  exit 0
fi

git config user.name "Lamp Light Release Bot"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add "$CASK_PATH"
git commit -m "lamp-light ${VERSION}"
git push origin HEAD
echo "Pushed homebrew-tap update for lamp-light ${VERSION}"
