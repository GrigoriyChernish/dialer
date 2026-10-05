#!/usr/bin/env bash
# Публікує збірку для користувачів у Tigris (docs/stage-builds.md, «Роздача користувачам»):
#   scripts/publish-build.sh <android|macos> <файл або glob>
# Один файл на платформу: android/dialer.apk, macos/dialer.dmg, плюс запис у manifest.json.
# Ключі бакета (BUCKET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3, AWS_REGION) беремо з середовища
# або з файлу ~/.gradle/dialer/tigris.env (чи $DIALER_TIGRIS_ENV). Вантажимо через `curl` за підписаним посиланням (без aws CLI).
# Без ключів крок пропускається: збірка не падає.
set -euo pipefail

platform="${1:-}"
pattern="${2:-}"
case "$platform" in
  android) key="android/dialer.apk" ;;
  macos) key="macos/dialer.dmg" ;;
  *) echo "publish-build: потрібна платформа android або macos" >&2; exit 2 ;;
esac

env_file="${DIALER_TIGRIS_ENV:-$HOME/.gradle/dialer/tigris.env}"
if [ -f "$env_file" ]; then set -a; . "$env_file"; set +a; fi

skip() { echo "publish-build: пропущено ($1)"; exit 0; }
[ -n "${BUCKET_NAME:-}" ] && [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ] || skip "немає ключів Tigris: $env_file"

# glob розкриваємо тут, з найсвіжішого файлу
# shellcheck disable=SC2086
file="$(ls -t $pattern 2>/dev/null | head -n1 || true)"
[ -n "$file" ] && [ -f "$file" ] || { echo "publish-build: файл не знайдено: $pattern" >&2; exit 1; }

export AWS_ENDPOINT_URL_S3="${AWS_ENDPOINT_URL_S3:-https://fly.storage.tigris.dev}"
export AWS_REGION="${AWS_REGION:-auto}"

root="$(cd "$(dirname "$0")/.." && pwd)"
url() { "$root/apps/server/node_modules/.bin/tsx" "$root/scripts/tigris-url.ts" "$1" "$2"; }
version="$(node -p "require('$root/apps/mobile/src-tauri/tauri.conf.json').version")"
size="$(wc -c < "$file" | tr -d ' ')"
sha="$(shasum -a 256 "$file" | cut -d' ' -f1)"

echo "publish-build: $platform $version, $size байт → s3://$BUCKET_NAME/$key"
curl -fS --progress-bar -T "$file" "$(url put "$key")" -o /dev/null

manifest="$(mktemp)"
trap 'rm -f "$manifest"' EXIT
curl -fs "$(url get manifest.json)" -o "$manifest" 2>/dev/null || echo '{}' > "$manifest"
node -e "
const fs = require('fs');
const [file, platform, version, size, sha] = process.argv.slice(1);
const m = JSON.parse(fs.readFileSync(file, 'utf8'));
m[platform] = { version, size: Number(size), sha256: sha, updatedAt: new Date().toISOString() };
fs.writeFileSync(file, JSON.stringify(m, null, 2));
" "$manifest" "$platform" "$version" "$size" "$sha"
curl -fsS -T "$manifest" "$(url put manifest.json)" -o /dev/null
echo "publish-build: готово"
