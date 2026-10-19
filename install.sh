#!/bin/sh
# browse-url installer
#
# - installs the skill so AI agents can discover it (skill-aware agents only)
# - symlinks the `browse` command into a directory on your PATH
#
# Usage:
#   ./install.sh              # install cli + skill
#   ./install.sh cli          # cli only
#   ./install.sh skill        # skill only
set -eu

ROOT=$(cd "$(dirname "$0")" && pwd)
MODE=${1:-all}

# 1) dependencies
if [ "$MODE" = "all" ] || [ "$MODE" = "cli" ]; then
  command -v node >/dev/null 2>&1 || { echo "error: node is required"; exit 1; }
  if [ ! -d "$ROOT/cli/node_modules" ]; then
    echo "==> installing cli dependencies (playwright-core)"
    (cd "$ROOT/cli" && (command -v pnpm >/dev/null 2>&1 && pnpm add playwright-core || npm install))
  fi

  # pick a writable dir on PATH
  BIN_DIR=""
  for d in "$HOME/.local/bin" "/usr/local/bin"; do
    case ":$PATH:" in *":$d:"*)
      if [ -w "$d" ] || [ -w "$(dirname "$d")" ]; then BIN_DIR="$d"; break; fi
      ;;
    esac
  done
  [ -n "$BIN_DIR" ] || { echo "error: no writable dir on PATH (expected ~/.local/bin)"; exit 1; }

  mkdir -p "$BIN_DIR"
  ln -sfn "$ROOT/cli/browse.mjs" "$BIN_DIR/browse"
  chmod +x "$ROOT/cli/browse.mjs"
  echo "==> linked: $BIN_DIR/browse"
fi

# 2) skill
if [ "$MODE" = "all" ] || [ "$MODE" = "skill" ]; then
  SKILL_DIR="$HOME/.agents/skills/browse-url"
  mkdir -p "$SKILL_DIR"
  cp "$ROOT/skills/browse-url/SKILL.md" "$SKILL_DIR/SKILL.md"
  cp "$ROOT/skills/browse-url/SKILL.zh-CN.md" "$SKILL_DIR/SKILL.zh-CN.md"
  echo "==> skill installed: $SKILL_DIR"
  # Claude Code reads ~/.claude/skills; mirror via relative symlink when that dir exists
  if [ -d "$HOME/.claude/skills" ]; then
    ln -sfn ../../.agents/skills/browse-url "$HOME/.claude/skills/browse-url"
    echo "==> mirrored for Claude Code: ~/.claude/skills/browse-url"
  fi
fi

cat <<'EOT'

Done. Try it:

  browse text  "https://example.com"
  browse shot  "https://example.com" out.png --full
  browse console "http://localhost:3000" --seconds 5

Requires Google Chrome (this CLI drives your installed Chrome, no browser download).
EOT
