#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

cmd_fresh() {
  info "Cleaning build artifacts..."
  rm -rf out/ release/

  info "Building app..."
  npm run build

  info "Starting dev server..."
  npm run dev
}

cmd_mac() {
  info "Cleaning..."
  rm -rf out/ release/

  info "Building app..."
  npm run build

  info "Creating macOS DMG..."
  npm run dist

  info "Done. Output:"
  ls -lh release/*.dmg 2>/dev/null || true
}

cmd_win() {
  info "Cleaning..."
  rm -rf out/ release/

  info "Building app..."
  npm run build

  info "Creating Windows ZIP..."
  npm run dist:win

  info "Done. Output:"
  ls -lh release/*.zip 2>/dev/null || true
}

usage() {
  cat <<EOF
Super CD Search - Build Script

Usage: $(basename "$0") <command>

Commands:
  fresh    Clean + build + start dev server
  refresh  Alias for fresh
  mac      Build and package as DMG for macOS
  win      Build and package as ZIP for Windows

Examples:
  $(basename "$0") fresh    # 开发调试
  $(basename "$0") mac      # 打包 macOS DMG
  $(basename "$0") win      # 打包 Windows ZIP
EOF
}

case "${1:-}" in
  fresh|refresh) cmd_fresh ;;
  mac)   cmd_mac ;;
  win)   cmd_win ;;
  -h|--help|help) usage ;;
  *)     error "Unknown command: ${1:-}. Run '$(basename "$0") help' for usage." ;;
esac
