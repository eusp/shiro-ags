#!/usr/bin/env bash
# audio-route.sh — send this machine's audio to the other machine (PC <-> laptop)
# or bring it back to the local speakers/headphones.
#
#   audio-route.sh local    -> output on this machine's own hardware
#   audio-route.sh send     -> stream this machine's audio to the other machine
#   audio-route.sh status   -> prints "local" or "send"
#
# Mechanism: pipewire-pulse module-native-protocol-tcp on the receiver +
# module-tunnel-sink on the sender, pointed at the receiver's default sink.

set -euo pipefail

# ── config ──────────────────────────────────────────────────────────────────
PC_HOST="nobara-pc"       ; PC_ADDR="nobara-pc.local"
LT_HOST="nobara-laptop"   ; LT_ADDR="nobara-laptop.local"
TUNNEL_SINK="send_to_other"
LATENCY_MSEC="${AUDIO_ROUTE_LATENCY:-120}"
STATE_FILE="${XDG_CACHE_HOME:-$HOME/.cache}/ags-audio-route.prev"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new)

# ── resolve the "other" machine ─────────────────────────────────────────────
me="$(hostname)"
case "$me" in
  "$PC_HOST") other_addr="$LT_ADDR" ;;
  "$LT_HOST") other_addr="$PC_ADDR" ;;
  *) echo "audio-route: unknown host '$me'" >&2; exit 1 ;;
esac

other_ipv4() {
  getent ahostsv4 "$other_addr" 2>/dev/null | awk 'NR==1{print $1}'
}

first_hw_sink() {
  pactl list sinks short | awk '{print $2}' \
    | grep -E '^(alsa_output|bluez_output)\.' | grep -vx "$TUNNEL_SINK" | head -n1
}

move_all_inputs() {
  local target="$1" id
  pactl list sink-inputs short | cut -f1 | while read -r id; do
    [ -n "$id" ] && pactl move-sink-input "$id" "$target" 2>/dev/null || true
  done
}

unload_tunnel_local() {
  pactl list modules short \
    | awk -v k="sink_name=$TUNNEL_SINK" 'index($0,k){print $1}' \
    | while read -r m; do pactl unload-module "$m" 2>/dev/null || true; done
}

# ── commands ────────────────────────────────────────────────────────────────
cmd_local() {
  local prev="" hw=""
  [ -f "$STATE_FILE" ] && prev="$(cat "$STATE_FILE" 2>/dev/null || true)"

  if [ -n "$prev" ] && [ "$prev" != "$TUNNEL_SINK" ] \
     && pactl list sinks short | awk '{print $2}' | grep -qx "$prev"; then
    hw="$prev"
  else
    hw="$(first_hw_sink)"
  fi
  [ -z "$hw" ] && { echo "audio-route: no local hardware sink found" >&2; exit 1; }

  pactl set-default-sink "$hw"
  move_all_inputs "$hw"
  unload_tunnel_local
  rm -f "$STATE_FILE"
  echo "local:$hw"
}

cmd_send() {
  local ip cur remote_sink
  ip="$(other_ipv4)"; [ -z "$ip" ] && ip="$other_addr"

  # remember where we were, so `local` can restore it
  cur="$(pactl get-default-sink)"
  if [ "$cur" != "$TUNNEL_SINK" ]; then
    mkdir -p "$(dirname "$STATE_FILE")"
    printf '%s\n' "$cur" > "$STATE_FILE"
  fi

  # 1. make sure the receiver accepts audio over the LAN
  "${SSH[@]}" "emerson@$other_addr" '
    pactl list modules short | grep -q module-native-protocol-tcp ||
      pactl load-module module-native-protocol-tcp listen=0.0.0.0 \
        auth-ip-acl="127.0.0.1/32;192.168.0.0/16;10.0.0.0/8"
  '

  # 2. find the receiver's current output
  remote_sink="$("${SSH[@]}" "emerson@$other_addr" 'pactl get-default-sink')"
  [ -z "$remote_sink" ] && { echo "audio-route: cannot read remote default sink" >&2; exit 1; }

  # 3. (re)create the tunnel on this machine, aimed at that sink
  unload_tunnel_local
  pactl load-module module-tunnel-sink \
    server="tcp:$ip" \
    sink="$remote_sink" \
    sink_name="$TUNNEL_SINK" \
    sink_properties=device.description="Enviar a ${other_addr%%.*}" \
    latency_msec="$LATENCY_MSEC" >/dev/null

  sleep 0.5
  pactl set-default-sink "$TUNNEL_SINK"
  move_all_inputs "$TUNNEL_SINK"

  # 4. best effort: if the stream landed unlinked on the receiver, attach it
  "${SSH[@]}" "emerson@$other_addr" 'bash -s' <<'REMOTE' 2>/dev/null || true
def="$(pactl get-default-sink)"
pactl list sink-inputs short | cut -f1 | while read -r id; do
  [ -n "$id" ] || continue
  s="$(pactl list sink-inputs | grep -A20 "Sink Input #$id\b" | awk -F': ' '/^\tSink: /{print $2; exit}')"
  [ "$s" = "4294967295" ] && pactl move-sink-input "$id" "$def" 2>/dev/null || true
done
REMOTE

  echo "send:$other_addr:$remote_sink"
}

cmd_status() {
  if [ "$(pactl get-default-sink)" = "$TUNNEL_SINK" ]; then echo "send"; else echo "local"; fi
}

case "${1:-status}" in
  local)  cmd_local  ;;
  send)   cmd_send   ;;
  status) cmd_status ;;
  *) echo "usage: $(basename "$0") {local|send|status}" >&2; exit 1 ;;
esac
