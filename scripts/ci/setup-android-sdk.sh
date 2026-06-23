#!/usr/bin/env bash
# Install Android SDK cmdline-tools for Gradle/Capacitor CI builds.
set -euo pipefail

ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-/opt/android-sdk}"
ANDROID_API="${ANDROID_API:-34}"
BUILD_TOOLS="${BUILD_TOOLS:-34.0.0}"
CMDLINE_ZIP="commandlinetools-linux-11076708_latest.zip"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq unzip wget

mkdir -p "${ANDROID_SDK_ROOT}/cmdline-tools"
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

cd "${tmpdir}"
wget -q "https://dl.google.com/android/repository/${CMDLINE_ZIP}"
unzip -q "${CMDLINE_ZIP}"
rm -rf "${ANDROID_SDK_ROOT}/cmdline-tools/latest"
mv cmdline-tools "${ANDROID_SDK_ROOT}/cmdline-tools/latest"

export ANDROID_SDK_ROOT ANDROID_HOME="${ANDROID_SDK_ROOT}"
export PATH="${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${ANDROID_SDK_ROOT}/platform-tools:${PATH}"

yes | sdkmanager --licenses >/dev/null
sdkmanager \
  "platform-tools" \
  "platforms;android-${ANDROID_API}" \
  "build-tools;${BUILD_TOOLS}"

if [ -d android ]; then
  echo "sdk.dir=${ANDROID_SDK_ROOT}" > android/local.properties
fi

if [ -n "${GITHUB_ENV:-}" ]; then
  {
    echo "ANDROID_SDK_ROOT=${ANDROID_SDK_ROOT}"
    echo "ANDROID_HOME=${ANDROID_SDK_ROOT}"
    echo "PATH=${PATH}"
  } >> "${GITHUB_ENV}"
fi

echo "Android SDK ready at ${ANDROID_SDK_ROOT}"
