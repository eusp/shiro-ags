# Ajustes del sistema

Cambios fuera de este repo (en `/etc` o en el estado del usuario) de los que
depende que algunas partes de la barra funcionen bien. Si se reinstala un equipo,
hay que repetirlos. El UPS de la PC tiene su propia guía: [UPS.md](UPS.md).

| Equipo | Ajuste | Para qué |
|---|---|---|
| PC | [Chip Wi-Fi/Bluetooth sin suspensión](#pc-chip-wi-fibluetooth-sin-suspensión) | Auriculares Bluetooth con el Wi-Fi apagado |
| PC | [Sin cambio automático a manos libres](#pc-sin-cambio-automático-a-manos-libres) | Auriculares siempre en buena calidad |
| Laptop | [Modo conservación de la batería](#laptop-modo-conservación-de-la-batería) | Carga solo hasta ~60 % |
| Laptop | [Wi-Fi sin ahorro de energía](#laptop-wi-fi-sin-ahorro-de-energía) | Sin cortes al enviar audio a la PC |

---

## PC: chip Wi-Fi/Bluetooth sin suspensión

El Wi-Fi y el Bluetooth de la PC son el mismo chip USB, un Realtek RTL8821CU
(`0bda:c820`, drivers `rtw88_8821cu` y `btusb`). Con el Wi-Fi apagado nada mantenía
despierto el USB, se suspendía a los 2 s y el Bluetooth se dormía con él: para usar
los auriculares había que encender el Wi-Fi primero.

Los botones de Wi-Fi y Bluetooth siguen funcionando igual; solo se evita que el USB
del chip se duerma.

`/etc/udev/rules.d/50-rtl8821cu-no-suspend.rules`
```
# Wi-Fi + Bluetooth Realtek RTL8821CU (mismo chip USB). Con el Wi-Fi apagado el
# USB se suspendía y el Bluetooth (auriculares) dejaba de funcionar.
ACTION=="add|change", SUBSYSTEM=="usb", ATTR{idVendor}=="0bda", ATTR{idProduct}=="c820", ATTR{power/control}="on"
```

`/etc/modprobe.d/btusb-no-autosuspend.conf`
```
# Bluetooth del RTL8821CU: sin autosuspensión USB (ver 50-rtl8821cu-no-suspend.rules)
options btusb enable_autosuspend=0
```

Aplicar sin reiniciar (la opción de `btusb` igual necesita reinicio):
```bash
sudo udevadm control --reload
sudo udevadm trigger --action=change --subsystem-match=usb --attr-match=idVendor=0bda
```

Comprobar:
```bash
cat /sys/bus/usb/devices/1-7/power/control        # on  (1-7 = puerto del chip; ver lsusb -t)
cat /sys/module/btusb/parameters/enable_autosuspend   # N  (después de reiniciar)
```

Aplicado el 2026-11-22. Pendiente de confirmar en un arranque con el Wi-Fi apagado.

## PC: sin cambio automático a manos libres

Los auriculares Bluetooth tienen dos modos: A2DP (estéreo, buena calidad, sin
micrófono) y manos libres / HFP (mono, 16 kHz, con micrófono). WirePlumber cambiaba
solo a manos libres cuando una app abría el micrófono (por ejemplo un emulador al
arrancar): el sonido empeoraba, el audio de esa app se perdía y PipeWire llegó a
colgarse al cambiar con varias apps sonando.

```bash
wpctl settings --save bluetooth.autoswitch-to-headset-profile false
```
Queda en `~/.local/state/wireplumber/sm-settings`. Para usar el micrófono de los
auriculares: interruptor **Micrófono** en el menú del Bluetooth de la topbar. Mientras
están en manos libres, el ícono muestra **HFP** en naranja.

## Laptop: modo conservación de la batería

Lenovo IdeaPad (81BF): el firmware puede parar la carga en ~60 % y dejar la laptop
funcionando con el cargador. El tope lo fija el firmware (no se puede elegir 70 u 80);
el ajuste es solo encendido/apagado, y **se pierde al reiniciar**, así que una regla
de udev lo vuelve a activar cada vez que carga el driver.

`/etc/udev/rules.d/90-ideapad-conservation.rules`
```
# Lenovo IdeaPad: modo conservación siempre activo (carga hasta ~60%).
# El firmware lo olvida al reiniciar, así que se vuelve a poner al cargar el driver.
ACTION=="bind", SUBSYSTEM=="platform", DRIVER=="ideapad_acpi", ATTR{conservation_mode}="1"
```

Activar ahora y comprobar:
```bash
echo 1 | sudo tee /sys/bus/platform/drivers/ideapad_acpi/VPC2004:00/conservation_mode
cat /sys/bus/platform/drivers/ideapad_acpi/VPC2004:00/conservation_mode   # 1
cat /sys/class/power_supply/BAT0/status                                    # Not charging por encima de ~60 %
```

Para cargar al 100 % una vez (un viaje): el mismo `tee` con `0`. Vuelve a `1` en el
siguiente reinicio.

Comportamiento: carga hasta ~60 %, para y funciona con la corriente; solo vuelve a
cargar cuando baja de ~50-55 %. Si está por encima de 60 % (por ejemplo tras cargar
al 100 %), no carga y baja con el uso sin cargador. En la topbar: verde con rayo =
cargando, celeste = con corriente sin cargar, gris = con batería.

## Laptop: Wi-Fi sin ahorro de energía

El ahorro de energía del Wi-Fi provoca cortes en el audio que la laptop envía a la PC
(`scripts/audio-route.sh`, por RTP) cuando va por Wi-Fi.

`/etc/NetworkManager/conf.d/wifi-powersave-off.conf`
```ini
[connection]
wifi.powersave = 2
```
```bash
sudo nmcli general reload conf
```
Se aplica al reconectarse el Wi-Fi. Comprobar con `iw dev wlan0 get power_save` → `off`.
