#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
HOST_NAME="io.opencode_team_runtime.bridge"
HOST_SCRIPT="$PROJECT_ROOT/.opencode/browser-extension/native-host/opencode-team-native-host.mjs"
WRAPPER="$PROJECT_ROOT/.opencode/browser-extension/native-host/opencode-team-native-host.sh"

cat > "$WRAPPER" <<SH
#!/usr/bin/env bash
export OPENCODE_TEAM_PROJECT_ROOT="$PROJECT_ROOT"
exec node "$HOST_SCRIPT"
SH
chmod +x "$WRAPPER"

case "$(uname -s)" in
  Linux*)
    BASE="${XDG_CONFIG_HOME:-$HOME/.config}/google-chrome/NativeMessagingHosts"
    ;;
  Darwin*)
    BASE="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    ;;
  *)
    echo "Unsupported OS for automatic manifest install. Create a nativeMessaging manifest manually." >&2
    exit 1
    ;;
esac
mkdir -p "$BASE"
cat > "$BASE/$HOST_NAME.json" <<JSON
{
  "name": "$HOST_NAME",
  "description": "OpenCode Team Browser Bridge native host",
  "path": "$WRAPPER",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://__EXTENSION_ID_PLACEHOLDER__/"
  ]
}
JSON
cat <<MSG
Installed native host manifest:
  $BASE/$HOST_NAME.json

Before nativeMessaging can be used, replace __EXTENSION_ID_PLACEHOLDER__ with the unpacked extension ID shown on chrome://extensions.
P2.6 currently uses localhost polling by default; nativeMessaging is scaffolded for future bootstrap mode.
MSG
