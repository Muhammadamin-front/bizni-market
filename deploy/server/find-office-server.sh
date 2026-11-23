#!/bin/sh
# Prints the office server's current LAN IPv4 address. The router hands it out by DHCP, so it changes;
# the network card's MAC address does not. Used by ~/.ssh/config (crm-server, crm-tunnel).
MAC="f4:b5:20:56:35:ef"
LAST="$HOME/.ssh/office-server-last-ip"

lookup() { arp -an | awk -v m="$MAC" 'tolower($4) == m { gsub(/[()]/, "", $2); print $2; exit }'; }

ip="$(lookup)"
if [ -z "$ip" ]; then
  # Not in the ARP cache yet: ping the whole /24 once (1 s each, in parallel), then look again.
  net="$(ipconfig getifaddr en0 2>/dev/null | cut -d. -f1-3)"
  [ -n "$net" ] || net="192.168.1"
  i=1
  while [ $i -le 254 ]; do ping -c1 -t1 "$net.$i" >/dev/null 2>&1 & i=$((i + 1)); done
  wait
  ip="$(lookup)"
fi
[ -n "$ip" ] || ip="$(cat "$LAST" 2>/dev/null)"
[ -n "$ip" ] || { echo "office server not found on this network (MAC $MAC) - are you in the office?" >&2; exit 1; }
prev="$(cat "$LAST" 2>/dev/null)"
if [ -n "$prev" ] && [ "$prev" != "$ip" ]; then echo "NOTE: office server IP changed: $prev -> $ip" >&2; fi
echo "$ip" > "$LAST"
echo "$ip"
