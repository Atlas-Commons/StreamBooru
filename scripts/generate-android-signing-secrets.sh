#!/usr/bin/env bash
# Generate a NEW Android release keystore and print values for Forgejo/GitHub secrets.
# Run locally once, save output in a password manager, then add secrets to Forgejo.
#
# Usage:
#   ./scripts/generate-android-signing-secrets.sh
#   ./scripts/generate-android-signing-secrets.sh /path/to/save/streambooru-release.p12
set -euo pipefail

OUT="${1:-$(mktemp -d)/streambooru-release.p12}"
ALIAS="${ANDROID_KEY_ALIAS:-streambooru}"
STORE_PASS="${ANDROID_KEYSTORE_PASSWORD:-}"
KEY_PASS="${ANDROID_KEY_PASSWORD:-}"

if ! command -v keytool >/dev/null 2>&1; then
  echo "Install a JDK (keytool required). On Arch: sudo pacman -S jdk-openjdk" >&2
  exit 1
fi

if [[ -z "$STORE_PASS" ]]; then
  read -rsp "Keystore password (ANDROID_KEYSTORE_PASSWORD): " STORE_PASS
  echo
fi
if [[ -z "$KEY_PASS" ]]; then
  read -rsp "Key password (ANDROID_KEY_PASSWORD) [same as keystore]: " KEY_PASS
  echo
  KEY_PASS="${KEY_PASS:-$STORE_PASS}"
fi

rm -f "$OUT"
keytool -genkeypair -v \
  -keystore "$OUT" \
  -storetype PKCS12 \
  -storepass "$STORE_PASS" \
  -alias "$ALIAS" \
  -keypass "$KEY_PASS" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -dname "CN=StreamBooru, OU=Atlas Commons, O=Atlas Commons, L=Unknown, ST=Unknown, C=GB"

echo
echo "=== Keystore written to ==="
echo "$OUT"
echo
echo "=== Verify ==="
keytool -list -keystore "$OUT" -storetype PKCS12 -storepass "$STORE_PASS" -alias "$ALIAS"
echo
echo "=== Forgejo / GitHub secrets (copy these) ==="
echo "ANDROID_KEY_ALIAS=$ALIAS"
echo "ANDROID_KEYSTORE_PASSWORD=<the password you entered>"
echo "ANDROID_KEY_PASSWORD=<the key password you entered>"
echo
echo "ANDROID_KEYSTORE_BASE64 (single line):"
base64 -w0 "$OUT" 2>/dev/null || base64 "$OUT" | tr -d '\n'
echo
echo
echo "=== Important ==="
echo "- Back up $OUT somewhere safe (encrypted backup / password manager attachment)."
echo "- Do NOT commit the .p12 file to git."
echo "- A new key cannot sign updates for an app already on Play Store with the OLD key."
echo "  Sideload/APK releases are fine; Play Store may need a new app or key reset."
