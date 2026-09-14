import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import Bluetooth, { btLog } from "../../lib/bluetooth"
import { MenuPopover } from "../Shared/MenuPopover"
import { stateFile } from "../../lib/localState"

const DEVICES_FILE = stateFile("bt-devices.json")

interface SavedDevice {
    name: string
    address: string
    icon: string
}

const loadDevices = (): SavedDevice[] => {
    try {
        const file = Gio.File.new_for_path(DEVICES_FILE)
        const [, contents] = file.load_contents(null)
        return JSON.parse(new TextDecoder().decode(contents))
    } catch {
        return []
    }
}

const writeDevices = (devices: SavedDevice[]) => {
    try {
        const file = Gio.File.new_for_path(DEVICES_FILE)
        file.replace_contents(
            new TextEncoder().encode(JSON.stringify(devices, null, 2)),
            null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null
        )
    } catch (e) {
        print(`error guardando dispositivos: ${e}`)
    }
}

// Guarda al frente (más reciente primero) para que "Anteriores" quede
// ordenado por uso.
const saveDevice = (dev: SavedDevice) => {
    const devices = loadDevices().filter(d => d.address !== dev.address)
    devices.unshift(dev)
    writeDevices(devices)
}

const forgetDevice = (address: string) => {
    writeDevices(loadDevices().filter(d => d.address !== address))
}

let widgetCount = 0

export default function BluetoothIndicator() {
    const bt = Bluetooth.get_default()
    if (!bt) return new Gtk.Box()

    // Hay un widget por barra: el número dice de cuál viene cada línea
    const widgetId = ++widgetCount
    const log = (msg: string) => btLog(`#${widgetId} ${msg}`)
    log(`widget creado (AGS pid ${Gio.Credentials.new().get_unix_pid()})`)

    const icon = new Gtk.Image()
    const menubutton = new Gtk.MenuButton({ child: icon })

    let isScanning = false
    let currentDiscovered: Map<string, SavedDevice> = new Map()

    // Mismo esquema que Network.tsx: una fila de estado + una fila de
    // control arriba (tamaño estable, nunca cambian de alto), y todo lo
    // que puede aparecer/desaparecer (mensajes, dispositivos) vive dentro
    // del scrolled de abajo, que tiene alto fijo. El popover vive en una
    // superficie de layer-shell: si el contenido cambia de tamaño total
    // después de abierto, Hyprland lo descarta en vez de redimensionarlo,
    // así que todo lo dinámico tiene que quedar contenido ahí adentro.
    const statusIcon = new Gtk.Image({ iconName: "bluetooth-disabled-symbolic" })
    const statusLine = new Gtk.Label({ label: "", halign: Gtk.Align.START, hexpand: true, ellipsize: 3 })
    const statusInner = new Gtk.Box({ spacing: 8 })
    statusInner.append(statusIcon)
    statusInner.append(statusLine)
    const statusRow = new Gtk.Box({ spacing: 4, cssClasses: ["popover-item"] })
    statusRow.append(statusInner)

    const toggleLabel = new Gtk.Label({ label: "Bluetooth", xalign: 0 })
    const powerSwitch = new Gtk.Switch({
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.END,
        hexpand: true,
        cssClasses: ["compact-switch"],
    })

    const scanSpinner = new Gtk.Spinner({ visible: false })
    const scanBtn = new Gtk.Button({
        cssClasses: ["popover-icon-btn"],
        valign: Gtk.Align.CENTER,
        child: (() => {
            const b = new Gtk.Box({ spacing: 4 })
            b.append(new Gtk.Image({ iconName: "system-search-symbolic" }))
            b.append(scanSpinner)
            return b
        })()
    })

    const toggleRow = new Gtk.Box({ spacing: 8, cssClasses: ["popover-row"] })
    toggleRow.append(toggleLabel)
    toggleRow.append(scanBtn)
    toggleRow.append(powerSwitch)

    // Aviso breve de error (falla al conectar/emparejar), se oculta solo.
    // Vive dentro del scrolled de alto fijo, así que mostrarlo/ocultarlo
    // no cambia el tamaño total del popover.
    const statusLabel = new Gtk.Label({
        label: "",
        cssClasses: ["bt-status-error"],
        wrap: true,
        xalign: 0,
        visible: false,
    })
    let statusHideId = 0
    const showError = (msg: string) => {
        log(`aviso en el widget: ${msg}`)
        if (statusHideId) GLib.source_remove(statusHideId)
        statusLabel.label = msg
        statusLabel.visible = true
        statusHideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 4000, () => {
            statusLabel.visible = false
            statusHideId = 0
            return GLib.SOURCE_REMOVE
        })
    }

    // Slot conectado actualmente
    const connectedIcon = new Gtk.Image({ iconName: "bluetooth-symbolic" })
    const connectedName = new Gtk.Label({ label: "", halign: Gtk.Align.START, hexpand: true, ellipsize: 3 })
    const connectedInner = new Gtk.Box({ spacing: 8 })
    connectedInner.append(connectedIcon)
    connectedInner.append(connectedName)
    connectedInner.append(new Gtk.Label({ label: "●", cssClasses: ["bt-connected"] }))
    // El hover va en el botón, no en la caja interna — mismo motivo que en
    // los slots de "Anteriores": evita el doble-hover al superponer el
    // resaltado nativo del botón con el de popover-item.
    const connectedBtn = new Gtk.Button({ child: connectedInner, cssClasses: ["popover-item"], visible: false })
    // Un solo listener de por vida: lee el dispositivo conectado al momento
    // del clic en vez de cerrar sobre un valor capturado en update().
    connectedBtn.connect("clicked", () => {
        const connected = (bt.devices || []).find((d: any) => d.connected)
        log(`botón [conectado] → desconectar ${connected ? `${connected.name} (${connected.address})` : "(no hay ninguno conectado)"}`)
        if (connected) connected.disconnect_device(null)
    })

    // Slots para anteriormente conectados (del JSON)
    const savedSectionLabel = new Gtk.Label({
        label: "Anteriores",
        xalign: 0,
        cssClasses: ["popover-section-title"],
        visible: false,
    })
    const makeSlot = () => {
        const slotIcon = new Gtk.Image({ iconName: "bluetooth-symbolic" })
        const slotName = new Gtk.Label({ label: "", halign: Gtk.Align.START, hexpand: true, ellipsize: 3 })
        const connectInner = new Gtk.Box({ spacing: 8 })
        connectInner.append(slotIcon)
        connectInner.append(slotName)
        // Solo este botón lleva el hover de "popover-item" — antes la fila
        // entera también lo tenía, y se veían dos hovers superpuestos al
        // pasar el mouse (el de la fila y el nativo del botón "flat").
        const connectBtn = new Gtk.Button({ child: connectInner, cssClasses: ["popover-item"], hexpand: true })
        const forgetBtn = new Gtk.Button({ iconName: "edit-delete-symbolic", cssClasses: ["popover-icon-btn", "dangerous"] })
        const row = new Gtk.Box({ spacing: 4, visible: false })
        row.append(connectBtn)
        row.append(forgetBtn)

        const slot = { row, slotIcon, slotName, connectBtn, forgetBtn, address: "" }

        connectBtn.connect("clicked", async () => {
            // Se leen antes de esperar: updateSavedSlots puede reasignar la fila mientras tanto
            const { address } = slot
            const name = slot.slotName.label
            if (!address) return
            log(`botón [Anteriores] → conectar ${name} (${address})`)
            connectBtn.sensitive = false
            const ok = await connectSaved(address)
            connectBtn.sensitive = true
            log(`botón [Anteriores] ${name}: ${ok ? "conectado" : "no se pudo conectar"}`)
            if (!ok) showError(`No se pudo conectar a ${name}`)
        })
        forgetBtn.connect("clicked", async () => {
            const { address } = slot
            const name = slot.slotName.label
            if (!address) return
            // Olvidar también borra el emparejamiento en BlueZ, no solo la fila de Anteriores
            const dev = findDevice(address)
            log(`botón [Anteriores] → olvidar ${name} (${address}): ${dev ? "se borra de BlueZ y de bt-devices.json" : "BlueZ no lo tiene, solo se borra de bt-devices.json"}`)
            if (dev && bt.adapter) {
                forgetBtn.sensitive = false
                const error = await bt.adapter.remove_device(dev.path)
                forgetBtn.sensitive = true
                if (error) showError(`No se pudo borrar ${name} de BlueZ`)
            }
            forgetDevice(address)
            updateSavedSlots()
        })

        return slot
    }
    const savedSlots = Array.from({ length: 10 }, makeSlot)

    // Slots para dispositivos del scan
    const scanSectionLabel = new Gtk.Label({
        label: "Disponibles",
        xalign: 0,
        cssClasses: ["popover-section-title"],
        visible: false,
    })
    const makeScanSlot = () => {
        const slotIcon = new Gtk.Image({ iconName: "bluetooth-symbolic" })
        const slotName = new Gtk.Label({ label: "", halign: Gtk.Align.START, hexpand: true, ellipsize: 3 })
        const connectBtn = new Gtk.Button({
            label: "Conectar",
            cssClasses: ["suggested-action", "bt-scan-connect"],
            valign: Gtk.Align.CENTER,
        })
        const inner = new Gtk.Box({ spacing: 8, hexpand: true, cssClasses: ["popover-item", "bt-scan-item"] })
        inner.append(slotIcon)
        inner.append(slotName)
        inner.append(connectBtn)
        const row = new Gtk.Box({ visible: false })
        row.append(inner)

        const slot = { row, slotIcon, slotName, connectBtn, address: "" }

        connectBtn.connect("clicked", async () => {
            // Se leen antes de esperar: mientras empareja, BlueZ marca el
            // dispositivo como conectado, updateScanSlots lo saca de la lista y
            // vacía la dirección de esta fila (el connect salía sin dirección).
            const { address } = slot
            const name = slot.slotName.label
            const dev = currentDiscovered.get(address)
            if (!address) return
            log(`botón [Disponibles] → emparejar y conectar ${name} (${address})`)
            connectBtn.sensitive = false
            await pairDevice(address)
            const connected = await connectDevice(address)
            connectBtn.sensitive = true
            log(`botón [Disponibles] ${name}: ${connected ? "conectado, se guarda en Anteriores" : "no se pudo conectar"}`)
            if (!connected) {
                showError(`No se pudo conectar a ${name}`)
                return
            }
            if (dev) saveDevice(dev)
            updateSavedSlots()
            updateScanSlots()
        })

        return slot
    }
    const scanSlots = Array.from({ length: 5 }, makeScanSlot)

    const getConnectedAddress = () =>
        (bt.devices || []).find((d: any) => d.connected)?.address

    // Si BlueZ tiene el dispositivo registrado (emparejado o recién descubierto)
    const isKnown = (address: string) =>
        (bt.devices || []).some((d: any) => d.address === address)

    const findDevice = (address: string) =>
        (bt.devices || []).find((d: any) => d.address === address)

    // Emparejar puede fallar solo porque ya estaba emparejado antes;
    // lo que de verdad importa es si después conecta.
    // Con el adaptador en Pairable=false, BlueZ empareja sin guardar la clave
    // (el kernel queda sin "bondable") y los M100 rechazan después cualquier
    // perfil (pruebas 3 y 4). Se enciende solo mientras dura el emparejamiento,
    // como hacen los paneles de Bluetooth de GNOME o KDE.
    const pairDevice = async (address: string) => {
        const dev = findDevice(address)
        if (!dev) return log(`emparejar ${address}: BlueZ no lo tiene`)
        const adapter = bt.adapter
        const wasPairable = adapter?.pairable ?? false
        log(`emparejar ${dev.name}: adaptador Pairable=${wasPairable}${wasPairable ? "" : ", se enciende mientras empareja"}`)
        if (adapter && !wasPairable) await adapter.set_pairable(true)
        await dev.pair()
        if (adapter && !wasPairable) await adapter.set_pairable(false)
    }

    // Audio primero: con los M100, Connect espera ~21 s al perfil Hands-Free,
    // que no responde, y al vencer BlueZ corta todo el enlace antes de llegar
    // a A2DP (prueba 3). Si A2DP falla (o el dispositivo no es de audio), se
    // intenta Connect con todos los perfiles.
    const connectDevice = async (address: string) => {
        const dev = findDevice(address)
        if (!dev) {
            log(`conectar ${address}: BlueZ no lo tiene`)
            return false
        }
        if (!await dev.connectAudio()) return true
        log(`conectar ${dev.name}: A2DP falló, se intenta Connect con todos los perfiles`)
        return !await dev.connectAll()
    }

    const updateConnected = () => {
        const connected = (bt.devices || []).find((d: any) => d.connected)
        if (connected) {
            connectedIcon.iconName = connected.icon || "bluetooth-symbolic"
            connectedName.label = connected.name || connected.address
            connectedBtn.visible = true
            saveDevice({
                name: connected.name || connected.address,
                address: connected.address,
                icon: connected.icon || "bluetooth-symbolic"
            })
        } else {
            connectedBtn.visible = false
        }
    }

    const updateSavedSlots = () => {
        const saved = loadDevices()
        const connectedAddress = getConnectedAddress()
        const filtered = saved.filter(d => d.address !== connectedAddress)

        savedSectionLabel.visible = filtered.length > 0

        savedSlots.forEach((slot, i) => {
            const dev = filtered[i]
            if (dev) {
                slot.slotIcon.iconName = dev.icon || "bluetooth-symbolic"
                slot.slotName.label = dev.name || dev.address
                slot.address = dev.address
                slot.row.visible = true
            } else {
                slot.address = ""
                slot.row.visible = false
            }
        })
    }

    const updateScanSlots = () => {
        const savedAddresses = new Set(loadDevices().map(d => d.address))
        const connectedAddress = getConnectedAddress()
        const available = [...currentDiscovered.values()].filter(
            d => !savedAddresses.has(d.address) && d.address !== connectedAddress
        )

        scanSectionLabel.visible = available.length > 0

        scanSlots.forEach((slot, i) => {
            const dev = available[i]
            if (dev) {
                slot.slotIcon.iconName = dev.icon || "bluetooth-symbolic"
                slot.slotName.label = dev.name || dev.address
                slot.address = dev.address
                slot.row.visible = true
            } else {
                slot.address = ""
                slot.row.visible = false
            }
        })
    }

    // Duración fija de la búsqueda: bluez la sigue haciendo indefinidamente
    // si nadie le manda StopDiscovery, así que sin este límite el ícono de
    // carga (y el escaneo real) quedan corriendo para siempre.
    const SCAN_DURATION_MS = 12000
    let scanHandlerId = 0
    let scanPollId = 0
    let scanStopId = 0

    const stopScan = () => {
        if (!isScanning) return
        log(`búsqueda: fin (${currentDiscovered.size} dispositivos vistos)`)
        isScanning = false
        scanSpinner.visible = false
        scanSpinner.spinning = false
        bt.adapter?.stop_discovery()
        if (scanHandlerId) { bt.disconnect(scanHandlerId); scanHandlerId = 0 }
        if (scanPollId) { GLib.source_remove(scanPollId); scanPollId = 0 }
        if (scanStopId) { GLib.source_remove(scanStopId); scanStopId = 0 }
    }

    const startScan = (reason: string) => {
        if (isScanning) return log(`búsqueda (${reason}): ya hay una en curso`)
        if (!bt.isPowered) return log(`búsqueda (${reason}): adaptador apagado, no se busca`)
        const adapter = bt.adapter
        if (!adapter) return log(`búsqueda (${reason}): no hay adaptador`)

        log(`búsqueda (${reason}): inicio, ${SCAN_DURATION_MS / 1000} s`)
        isScanning = true
        scanSpinner.visible = true
        scanSpinner.spinning = true
        currentDiscovered = new Map()

        adapter.start_discovery()

        const collect = () => {
            let changed = false
            for (const dev of bt.devices || []) {
                if (!currentDiscovered.has(dev.address)) {
                    changed = true
                    log(`búsqueda: visto ${dev.name || dev.address} (${dev.address}) conectado=${dev.connected}`)
                }
                currentDiscovered.set(dev.address, {
                    name: dev.name || dev.address,
                    address: dev.address,
                    icon: dev.icon || "bluetooth-symbolic"
                })
            }
            if (changed) updateScanSlots()
        }

        scanHandlerId = bt.connect("notify::devices", collect)
        scanPollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            collect()
            return GLib.SOURCE_CONTINUE
        })

        scanStopId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SCAN_DURATION_MS, () => {
            scanStopId = 0
            stopScan()
            return GLib.SOURCE_REMOVE
        })
    }

    scanBtn.connect("clicked", () => {
        log("botón [buscar]")
        startScan("botón buscar")
    })

    // Espera a que BlueZ vea el dispositivo; false si se acaba el tiempo.
    const waitForDevice = (address: string, ms: number) => new Promise<boolean>(resolve => {
        if (isKnown(address)) return resolve(true)
        const deadline = GLib.get_monotonic_time() + ms * 1000
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            const found = isKnown(address)
            if (!found && GLib.get_monotonic_time() < deadline) return GLib.SOURCE_CONTINUE
            resolve(found)
            return GLib.SOURCE_REMOVE
        })
    })

    // "Anteriores" sale de state/bt-devices.json, pero BlueZ puede haber
    // olvidado el dispositivo (a los audífonos les pasa al apagar el
    // adaptador, porque BlueZ no conserva su emparejamiento). Un connect
    // directo entonces falla, así que primero lo busca y lo empareja.
    const connectSaved = async (address: string) => {
        if (!isKnown(address)) {
            if (!bt.isPowered) {
                log(`conectar ${address}: BlueZ no lo conoce y el adaptador está apagado`)
                return false
            }
            log(`conectar ${address}: BlueZ no lo conoce, se busca hasta ${SCAN_DURATION_MS / 1000} s`)
            startScan("Anteriores")
            const t0 = GLib.get_monotonic_time()
            const found = await waitForDevice(address, SCAN_DURATION_MS)
            log(`conectar ${address}: ${found ? "apareció" : "no apareció"} tras ${Math.round((GLib.get_monotonic_time() - t0) / 1000)} ms`)
            if (!found) return false
            await pairDevice(address)
        } else {
            log(`conectar ${address}: BlueZ ya lo conoce, se conecta directo`)
        }
        return connectDevice(address)
    }

    let syncingSwitch = false
    powerSwitch.connect("notify::active", () => {
        if (syncingSwitch) return
        log(`botón [interruptor] → ${powerSwitch.active ? "encender" : "apagar"} Bluetooth (ahora está ${bt.isPowered ? "encendido" : "apagado"})`)
        bt.adapter?.set_powered(powerSwitch.active)
    })

    const listBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2 })
    listBox.append(statusLabel)
    listBox.append(connectedBtn)
    listBox.append(savedSectionLabel)
    savedSlots.forEach(s => listBox.append(s.row))
    listBox.append(scanSectionLabel)
    scanSlots.forEach(s => listBox.append(s.row))

    const scrolled = new Gtk.ScrolledWindow({
        heightRequest: 4 * 44,
        widthRequest: 220,
        child: listBox,
    })

    const topSection = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2, widthRequest: 220 })
    topSection.append(statusRow)
    topSection.append(toggleRow)

    const popover = MenuPopover(menubutton, [
        { title: "Bluetooth", customChild: topSection },
        { customChild: scrolled }
    ])

    menubutton.set_popover(popover)

    let lastPowered: boolean | null = null
    let lastConnected: string | null = null
    const update = () => {
        const connected = (bt.devices || []).find((d: any) => d.connected)
        if (bt.isPowered !== lastPowered) {
            log(`estado: Bluetooth ${bt.isPowered ? "encendido" : "apagado"}`)
            lastPowered = bt.isPowered
        }
        const connectedDesc = connected ? `${connected.name} (${connected.address})` : null
        if (connectedDesc !== lastConnected) {
            log(`estado: conectado → ${connectedDesc ?? "ninguno"}`)
            lastConnected = connectedDesc
        }
        const iconName = connected
            ? (connected.icon || "bluetooth-symbolic")
            : bt.isPowered ? "bluetooth-active-symbolic" : "bluetooth-disabled-symbolic"

        icon.iconName = bt.isPowered ? "bluetooth-active-symbolic" : "bluetooth-disabled-symbolic"
        statusIcon.iconName = iconName
        statusLine.label = connected
            ? (connected.name || connected.address)
            : bt.isPowered ? "Sin dispositivo conectado" : "Bluetooth desactivado"

        syncingSwitch = true
        powerSwitch.set_active(bt.isPowered)
        syncingSwitch = false
        scanBtn.sensitive = bt.isPowered

        if (!bt.isPowered) {
            // Apagar el adaptador a mitad de una búsqueda no la corta sola:
            // bluez sigue reportando "discovering" hasta que alguien manda
            // StopDiscovery explícitamente.
            stopScan()
        }
        updateConnected()
        updateSavedSlots()
        updateScanSlots()
    }

    bt.connect("notify::is-powered", update)
    bt.connect("notify::devices", update)

    update()
    return menubutton
}
