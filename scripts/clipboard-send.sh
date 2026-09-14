#!/usr/bin/env bash
# clipboard-send.sh — copy an item of this machine's cliphist history into the
# other machine's clipboard (PC <-> laptop).
#
#   clipboard-send.sh <id>   id from `cliphist list`
#
# The item is decoded as raw bytes, so images travel too; wl-copy on the other
# side detects the type.

set -euo pipefail

# ── config ──────────────────────────────────────────────────────────────────
PC_HOST="CachyOS-PC"      ; PC_ADDR="CachyOS-PC.local"
LT_HOST="CachyOS-Laptop"  ; LT_ADDR="CachyOS-Laptop.local"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new)

# ── resolve the "other" machine ─────────────────────────────────────────────
me="$(hostname)"
case "$me" in
  "$PC_HOST") other_addr="$LT_ADDR" ;;
  "$LT_HOST") other_addr="$PC_ADDR" ;;
  *) echo "clipboard-send: unknown host '$me'" >&2; exit 1 ;;
esac
other="${other_addr%%.*}"

fail() {
  notify-send -a "Portapapeles" "No se pudo enviar a $other" "$1" 2>/dev/null || true
  echo "clipboard-send: $1" >&2
  exit 1
}

id="${1:-}"
[[ "$id" =~ ^[0-9]+$ ]] || fail "id de cliphist inválido: '$id'"

# Runs on the other machine with the item on stdin. It goes through a temp file:
# wl-copy stays in the background serving the clipboard, and if it inherited the
# SSH session's output the connection would never close.
read -r -d '' remote <<'REMOTE' || true
f="$(mktemp)"
cat > "$f"
if [ ! -s "$f" ]; then rm -f "$f"; echo "llegó vacío" >&2; exit 1; fi
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
WAYLAND_DISPLAY="$(ls "$XDG_RUNTIME_DIR" 2>/dev/null | grep -m1 -E '^wayland-[0-9]+$')"
if [ -z "$WAYLAND_DISPLAY" ]; then rm -f "$f"; echo "no hay una sesión gráfica abierta" >&2; exit 1; fi
export WAYLAND_DISPLAY
setsid -f sh -c 'wl-copy < "$1"; rm -f "$1"' _ "$f" >/dev/null 2>&1
REMOTE

if ! err="$(cliphist decode "$id" \
    | "${SSH[@]}" "emerson@$other_addr" "bash -c $(printf '%q' "$remote")" 2>&1 >/dev/null)"; then
  fail "${err:-sin conexión por SSH con $other}"
fi

notify-send -a "Portapapeles" "Enviado a $other" "Ya está en su portapapeles" 2>/dev/null || true
echo "sent:$other"
