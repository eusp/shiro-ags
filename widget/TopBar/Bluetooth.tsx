import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import Bluetooth from "../../lib/bluetooth"
import { MenuPopover } from "../Shared/MenuPopover"

Gio._promisify(Gio.Subprocess.prototype, "wait_check_async", "wait_check_finish")

const DEVICES_FILE = `${GLib.get_home_dir()}/.config/ags/bt-devices.json`

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
// ordenado por uso y el auto-reconnect siempre tome el más reciente.
const saveDevice = (dev: SavedDevice) => {
    const devices = loadDevices().filter(d => d.address !== dev.address)
    devices.unshift(dev)
    writeDevices(devices)
}

const forgetDevice = (address: string) => {
    writeDevices(loadDevices().filter(d => d.address !== address))
}

// Envuelve bluetoothctl en una promesa: resuelve true/false según el
// código de salida real, en vez de disparar el subproceso a ciegas.
async function runBluetoothctl(...args: string[]): Promise<boolean> {
    try {
        const proc = Gio.Subprocess.new(
            ["bluetoothctl", ...args],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE
        )
        await proc.wait_check_async(null)
        return true
    } catch (e) {
        print(`bluetoothctl ${args.join(" ")} falló: ${e}`)
        return false
    }
}

export default function BluetoothIndicator() {
    const bt = Bluetooth.get_default()
    if (!bt) return new Gtk.Box()

    const icon = new Gtk.Image()
    const menubutton = new Gtk.MenuButton({ child: icon })
    const toggleLabel = new Gtk.Label({ label: "", hexpand: true, xalign: 0 })

    let isScanning = false
    let autoReconnectAttempted = false
    let currentDiscovered: Map<string, SavedDevice> = new Map()

    // Aviso breve de error (falla al conectar/emparejar), se oculta solo.
    const statusLabel = new Gtk.Label({
        label: "",
        cssClasses: ["bt-status-error"],
        wrap: true,
        xalign: 0,
        visible: false,
    })
    let statusHideId = 0
    const showError = (msg: string) => {
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
            if (!slot.address) return
            connectBtn.sensitive = false
            const ok = await runBluetoothctl("connect", slot.address)
            connectBtn.sensitive = true
            if (!ok) showError(`No se pudo conectar a ${slot.slotName.label}`)
        })
        forgetBtn.connect("clicked", () => {
            if (!slot.address) return
            forgetDevice(slot.address)
            updateSavedSlots()
        })

        return slot
    }
    const savedSlots = Array.from({ length: 10 }, makeSlot)

    // Botón buscar
    const scanSpinner = new Gtk.Spinner({ visible: false })
    const scanBtn = new Gtk.Button({
        cssClasses: ["popover-item"],
        child: (() => {
            const b = new Gtk.Box({ spacing: 8 })
            b.append(new Gtk.Image({ iconName: "network-wireless-acquiring-symbolic" }))
            b.append(new Gtk.Label({ label: "Buscar", hexpand: true, xalign: 0 }))
            b.append(scanSpinner)
            return b
        })()
    })

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
            if (!slot.address) return
            connectBtn.sensitive = false
            // Emparejar puede fallar solo porque ya estaba emparejado antes;
            // lo que de verdad importa es si el connect final funciona.
            await runBluetoothctl("pair", slot.address)
            const connected = await runBluetoothctl("connect", slot.address)
            connectBtn.sensitive = true
            if (!connected) {
                showError(`No se pudo conectar a ${slot.slotName.label}`)
                return
            }
            const dev = currentDiscovered.get(slot.address)
            if (dev) saveDevice(dev)
            updateSavedSlots()
            updateScanSlots()
        })

        return slot
    }
    const scanSlots = Array.from({ length: 5 }, makeScanSlot)

    const getConnectedAddress = () =>
        (bt.devices || []).find((d: any) => d.connected)?.address

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

    // Si se prende el adaptador y no hay nada conectado, intenta reconectar
    // solo al dispositivo más reciente (una vez por ciclo de encendido).
    const tryAutoReconnect = () => {
        if (autoReconnectAttempted || !bt.isPowered || getConnectedAddress()) return
        const [target] = loadDevices()
        if (!target) return
        autoReconnectAttempted = true
        runBluetoothctl("connect", target.address).then(ok => {
            if (!ok) showError(`No se pudo reconectar a ${target.name}`)
        })
    }

    scanBtn.connect("clicked", () => {
        if (isScanning) return
        const adapter = bt.adapter
        if (!adapter) return

        isScanning = true
        scanSpinner.visible = true
        scanSpinner.spinning = true
        currentDiscovered = new Map()

        adapter.start_discovery()

        const collect = () => {
            let changed = false
            for (const dev of bt.devices || []) {
                if (!currentDiscovered.has(dev.address)) changed = true
                currentDiscovered.set(dev.address, {
                    name: dev.name || dev.address,
                    address: dev.address,
                    icon: dev.icon || "bluetooth-symbolic"
                })
            }
            if (changed) updateScanSlots()
        }

        const handlerId = bt.connect("notify::devices", collect)
        const pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            collect()
            return GLib.SOURCE_CONTINUE
        })

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 15000, () => {
            adapter.stop_discovery()
            bt.disconnect(handlerId)
            GLib.source_remove(pollId)
            isScanning = false
            scanSpinner.visible = false
            scanSpinner.spinning = false
            return GLib.SOURCE_REMOVE
        })
    })

    const listBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2 })
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

    const popover = MenuPopover(menubutton, [
        {
            title: "Bluetooth",
            customChild: (() => {
                // Mismo ancho que el scrolled de abajo para que el popover
                // no cambie de tamaño entre estados (vacío, escaneando, etc).
                const section = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4, widthRequest: 220 })
                const row = new Gtk.Box({ spacing: 4 })

                const toggleBtn = new Gtk.Button({
                    cssClasses: ["popover-item"],
                    hexpand: true,
                    child: (() => {
                        const b = new Gtk.Box({ spacing: 8 })
                        b.append(new Gtk.Image({ iconName: "system-shutdown-symbolic" }))
                        b.append(toggleLabel)
                        return b
                    })()
                })
                toggleBtn.connect("clicked", () => bt.toggle())

                row.append(toggleBtn)
                row.append(scanBtn)
                section.append(row)
                section.append(statusLabel)
                return section
            })()
        },
        { customChild: scrolled }
    ])

    menubutton.set_popover(popover)

    const update = () => {
        icon.iconName = bt.isPowered ? "bluetooth-active-symbolic" : "bluetooth-disabled-symbolic"
        toggleLabel.label = bt.isPowered ? "Desactivar" : "Activar"
        if (!bt.isPowered) autoReconnectAttempted = false
        updateConnected()
        updateSavedSlots()
        updateScanSlots()
        tryAutoReconnect()
    }

    bt.connect("notify::is-powered", update)
    bt.connect("notify::devices", update)

    update()
    return menubutton
}
