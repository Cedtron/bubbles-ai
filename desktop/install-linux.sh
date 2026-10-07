#!/usr/bin/env bash
# ============================================================================
# Bubbles AI - Linux Desktop Installer
# Installs application shortcut and icon into user application menu
# ============================================================================
set -e

APP_URL="${1:-http://localhost:3000}"
ICON_DIR="${HOME}/.local/share/icons/hicolor/512x512/apps"
DESKTOP_DIR="${HOME}/.local/share/applications"

mkdir -p "$ICON_DIR" "$DESKTOP_DIR"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../frontend/logo.png" ]; then
  cp "$SCRIPT_DIR/../frontend/logo.png" "$ICON_DIR/bubbles-ai.png"
elif [ -f "$SCRIPT_DIR/logo.png" ]; then
  cp "$SCRIPT_DIR/logo.png" "$ICON_DIR/bubbles-ai.png"
fi

cat <<EOF > "$DESKTOP_DIR/bubbles-ai.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=Bubbles AI
Comment=Multi-agent AI assistant and developer workstation with Google AI brain
Exec=google-chrome --app=${APP_URL} || chromium --app=${APP_URL} || xdg-open ${APP_URL}
Icon=bubbles-ai
Terminal=false
Categories=Development;Utility;Office;
StartupWMClass=bubbles-ai
Actions=NewWindow;

[Desktop Action NewWindow]
Name=Open New Window
Exec=xdg-open ${APP_URL}
EOF

chmod +x "$DESKTOP_DIR/bubbles-ai.desktop"

# Refresh desktop database if available
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DESKTOP_DIR"
fi

echo "✅ Bubbles AI Desktop shortcut installed to $DESKTOP_DIR/bubbles-ai.desktop"
echo "You can now find Bubbles AI in your application launcher (GNOME, KDE, XFCE, etc.)!"
