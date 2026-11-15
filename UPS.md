# UPS (NUT)

Configuración del UPS CDP de la PC de escritorio. El indicador de la topbar
([widget/TopBar/Ups.tsx](widget/TopBar/Ups.tsx)) lee el UPS con `upsc` y solo
aparece si NUT está configurado; en la laptop queda oculto.

Lo que vive en `/etc/nut/` **no está en este repo**: si se reinstala la PC hay que
repetir estos pasos.

## El equipo

| Dato | Valor |
|---|---|
| USB | `0001:0000` (aparece en `lsusb` como "Fry's Electronics USB Device") |
| Controlador NUT | `nutdrv_qx`, protocolo **Megatec 0.09** (lo detecta solo) |
| Batería | 24 V nominal, 1 pack |
| Tipo | offline / line interactive |

No mide el porcentaje real: NUT lo estima por el voltaje (20,8 V = 0 %, 26 V = 100 %).
Con luz marca 100 % porque carga a ~29 V; sin luz el número puede bajar a saltos.
Tampoco calcula autonomía (`battery.runtime`).

## Instalación

### 1. Paquete
```bash
sudo pacman -S --needed nut
sudo nut-scanner -U        # debe listar driver nutdrv_qx con vendorid 0001 / productid 0000
```

### 2. `/etc/nut/ups.conf` — agregar al final
```ini
[cdp]
	driver = nutdrv_qx
	port = auto
	vendorid = 0001
	productid = 0000
	desc = "UPS CDP"
```

Prueba rápida del controlador, sin servicios (Ctrl+C para salir):
```bash
sudo /usr/lib/nut/nutdrv_qx -a cdp -u root -DD -d 1
```
Debe decir `Using protocol: Megatec 0.09` y listar `battery.charge`, `ups.status`, etc.

### 3. `/etc/nut/nut.conf`
```ini
MODE=standalone
```

### 4. `/etc/nut/upsd.conf` — agregar
```ini
LISTEN 127.0.0.1 3493
```
Solo escucha en la propia PC.

### 5. `/etc/nut/upsd.users` — agregar
```ini
[upsmon]
	password = <una contraseña cualquiera>
	upsmon primary
```

### 6. `/etc/nut/upsmon.conf` — agregar
```ini
# UPS CDP: apaga la PC cuando el UPS avisa batería baja (LB)
MONITOR cdp@localhost 1 upsmon <la misma contraseña> primary
SHUTDOWNCMD "/sbin/shutdown -h +0"
```
La contraseña es solo entre `upsmon` y `upsd` en la misma PC; se puede generar con
`head -c 18 /dev/urandom | base64 | tr -dc A-Za-z0-9`.

### 7. Servicios
```bash
sudo systemctl enable --now nut-driver-enumerator.service nut-server.service nut-monitor.service nut.target
```

Quedan corriendo:
- `nut-driver@cdp` — habla con el UPS por USB
- `nut-server` (`upsd`) — entrega los datos en `localhost:3493`
- `nut-monitor` (`upsmon`) — vigila el UPS y apaga la PC

## Comprobar
```bash
upsc cdp@localhost                      # todos los datos
upsc cdp@localhost ups.status           # OL = con luz, OB = con batería, LB = batería baja
journalctl -u nut-monitor -f            # ver "on battery" / "on line power" en un corte
```

## Cómo se comporta

| `ups.status` | Topbar | Sistema |
|---|---|---|
| `OL` (con luz) | Solo el ícono, color normal | — |
| `OB` (corte de luz) | Ícono + % en amarillo | Sigue funcionando |
| `OB LB` (batería baja) | Rojo | `upsmon` apaga la PC (`shutdown -h +0`) |

Un corte corto no apaga nada: el apagado solo ocurre cuando el UPS manda `LB`.
Probado el 2026-11-14 desconectándolo de la pared: NUT registró `on battery` y,
55 s después, `on line power`.

## Deshacer
Los originales quedaron como `/etc/nut/*.orig`:
```bash
sudo systemctl disable --now nut.target nut-monitor nut-server nut-driver-enumerator
cd /etc/nut && for f in *.orig; do sudo cp -p "$f" "${f%.orig}"; done
```
