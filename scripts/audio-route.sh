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
PC_HOST="CachyOS-PC"      ; PC_ADDR="CachyOS-PC.local"
LT_HOST="CachyOS-Laptop"  ; LT_ADDR="CachyOS-Laptop.local"
TUNNEL_SINK="send_to_other"
# WiFi + a Bluetooth (SBC) sink on the receiver stack two adaptive resamplers on
# top of a jittery link; 120 ms leaves no room to absorb clock drift, so the
# stream slowly turns "screechy". 400 ms gives the rate controllers slack.
LATENCY_MSEC="${AUDIO_ROUTE_LATENCY:-400}"
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
  local def="" i
  # unpin the output instead of pinning a local one: with no configured choice wireplumber
  # picks by priority, so it keeps switching to bluetooth headphones whenever they connect
  pw-metadata -n default -d 0 default.configured.audio.sink >/dev/null 2>&1 || true
  unload_tunnel_local
  for i in $(seq 1 20); do
    def="$(pactl get-default-sink)"
    [ -n "$def" ] && [ "$def" != "$TUNNEL_SINK" ] && break
    sleep 0.1
  done
  if [ -z "$def" ] || [ "$def" = "$TUNNEL_SINK" ]; then
    echo "audio-route: no local output sink found" >&2
    exit 1
  fi
  echo "local:$def"
}

fail() {
  notify-send -a "Audio" "No se pudo enviar el audio" "$1" 2>/dev/null || true
  echo "audio-route: $1" >&2
  exit "${2:-1}"
}

tunnel_ready() {
  pactl list sinks short | awk '{print $2}' | grep -qx "$TUNNEL_SINK"
}

cmd_send() {
  local ip remote_sink other i
  ip="$(other_ipv4)"; [ -z "$ip" ] && ip="$other_addr"
  other="${other_addr%%.*}"

  # 1. find the receiver's current output
  remote_sink="$("${SSH[@]}" "emerson@$other_addr" 'pactl get-default-sink' 2>/dev/null)" || remote_sink=""
  [ -z "$remote_sink" ] && fail "No hay conexión por SSH con $other. ¿Está encendida?"
  # the receiver is already sending to us: a second tunnel would loop the audio between both
  [ "$remote_sink" = "$TUNNEL_SINK" ] && fail "$other ya te está enviando su audio. Detén ese envío primero." 2

  # 2. make sure the receiver accepts audio over the LAN
  "${SSH[@]}" "emerson@$other_addr" '
    pactl list modules short | grep -q module-native-protocol-tcp ||
      pactl load-module module-native-protocol-tcp listen=0.0.0.0 \
        auth-ip-acl="127.0.0.1/32;192.168.0.0/16;10.0.0.0/8"
  ' >/dev/null 2>&1 || fail "No se pudo preparar la recepción de audio en $other."

  # 3. (re)create the tunnel on this machine, aimed at that sink
  unload_tunnel_local
  pactl load-module module-tunnel-sink \
    server="tcp:$ip" \
    sink="$remote_sink" \
    sink_name="$TUNNEL_SINK" \
    sink_properties=device.description="Enviar a $other" \
    latency_msec="$LATENCY_MSEC" >/dev/null

  # pipewire only creates the tunnel sink once it has connected to the receiver
  for i in $(seq 1 20); do tunnel_ready && break; sleep 0.25; done
  if ! tunnel_ready; then
    unload_tunnel_local
    fail "No se pudo conectar con el audio de $other (puerto 4713). Revisa su firewall."
  fi
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
