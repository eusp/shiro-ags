import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import Network, { AccessPoint } from "../../lib/network"
import { execAsync } from "ags/process"
import { MenuPopover } from "../Shared/MenuPopover"

const network = Network.get_default()
const { Connectivity } = Network

const WIFI_SLOTS = 8
// "nmcli device wifi rescan" vuelve casi al toque (solo dispara el rescan,
// no espera a que termine), así que sin esta duración fija el ícono de
// carga desaparecía antes de que NetworkManager terminara de escanear de
// verdad — daba la sensación de no saber si seguía buscando o no.
const WIFI_SCAN_DURATION_MS = 5000

// Conecta por bssid; si hace falta contraseña y se pasa una, la manda.
// Resuelve { ok, needsPassword } en vez de solo tirar la excepción, para
// que el widget sepa si debe abrir el campo de contraseña o solo mostrar
// un error genérico.
async function tryConnectWifi(bssid: string, password?: string): Promise<{ ok: boolean; needsPassword: boolean }> {
    const args = password
        ? ["nmcli", "device", "wifi", "connect", bssid, "password", password]
        : ["nmcli", "device", "wifi", "connect", bssid]
    try {
        await execAsync(args)
        return { ok: true, needsPassword: false }
    } catch (e) {
        const msg = String(e)
        return { ok: false, needsPassword: /secret/i.test(msg) }
    }
}

export default function NetworkIndicator() {
    const icon = new Gtk.Image()
    const menubutton = new Gtk.MenuButton({ child: icon })

    // Tarjeta de la conexión actual: ícono en círculo + nombre + estado
    const statusIcon = new Gtk.Image({ iconName: "network-wireless-symbolic", pixelSize: 18 })
    const statusIconBox = new Gtk.Box({ cssClasses: ["conn-card-icon"], valign: Gtk.Align.CENTER, halign: Gtk.Align.CENTER })
    statusIconBox.append(statusIcon)
    // Ícono centrado en el círculo; hexpand fijo en false para que no se propague
    statusIcon.set_hexpand(true)
    statusIcon.set_halign(Gtk.Align.CENTER)
    statusIconBox.set_hexpand(false)
    const statusLabel = new Gtk.Label({ label: "", xalign: 0, ellipsize: 3, maxWidthChars: 20, cssClasses: ["conn-card-title"] })
    const statusSub = new Gtk.Label({ label: "", xalign: 0, cssClasses: ["conn-card-sub"] })
    const statusTexts = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, valign: Gtk.Align.CENTER, hexpand: true })
    statusTexts.append(statusLabel)
    statusTexts.append(statusSub)
    const statusRow = new Gtk.Box({ spacing: 10, cssClasses: ["conn-card"] })
    statusRow.append(statusIconBox)
    statusRow.append(statusTexts)

    // Wi-Fi + actualizar + switch, todo en una sola fila: "Wi-Fi" y el
    // botón de actualizar van pegados a la izquierda, el switch queda
    // empujado lejos, a la derecha del todo.
    const wifiToggleLabel = new Gtk.Label({ label: "Wi-Fi", xalign: 0, hexpand: true, cssClasses: ["popover-section-title"] })
    const wifiSwitch = new Gtk.Switch({
        valign: Gtk.Align.CENTER,
        cssClasses: ["compact-switch"],
        tooltipText: "Encender o apagar Wi-Fi",
    })

    const refreshSpinner = new Gtk.Spinner({ visible: false })
    const refreshIcon = new Gtk.Image({ iconName: "view-refresh-symbolic" })
    const refreshBtn = new Gtk.Button({
        cssClasses: ["popover-icon-btn"],
        tooltipText: "Buscar redes",
        valign: Gtk.Align.CENTER,
        child: (() => {
            const b = new Gtk.Box({ spacing: 4 })
            b.append(refreshIcon)
            b.append(refreshSpinner)
            return b
        })()
    })

    // popover-row, no popover-item: la fila no es clicable como un todo
    // (el switch y el botón de actualizar tienen su propio hover), así que
    // no debe llevar el hover de .popover-item encima.
    const wifiRow = new Gtk.Box({ spacing: 6, cssClasses: ["popover-section-row"] })
    wifiRow.append(wifiToggleLabel)
    wifiRow.append(refreshBtn)
    wifiRow.append(wifiSwitch)


    const makeWifiSlot = () => {
        const signalIcon = new Gtk.Image({ iconName: "network-wireless-symbolic" })
        const nameLabel = new Gtk.Label({ label: "", halign: Gtk.Align.START, hexpand: true, ellipsize: 3 })
        const lockIcon = new Gtk.Image({ iconName: "network-wireless-encrypted-symbolic", visible: false })
        const activeMark = new Gtk.Label({ label: "●", cssClasses: ["bt-connected"], visible: false })

        const displayInner = new Gtk.Box({ spacing: 8, hexpand: true })
        displayInner.append(signalIcon)
        displayInner.append(nameLabel)
        displayInner.append(lockIcon)
        displayInner.append(activeMark)
        const displayBtn = new Gtk.Button({ child: displayInner, cssClasses: ["popover-item"], hexpand: true })

        const passwordEntry = new Gtk.PasswordEntry({
            hexpand: true,
            showPeekIcon: true,
            placeholderText: "Contraseña",
        })
        const submitBtn = new Gtk.Button({ iconName: "object-select-symbolic", cssClasses: ["popover-icon-btn"] })
        const cancelBtn = new Gtk.Button({ iconName: "process-stop-symbolic", cssClasses: ["popover-icon-btn", "dangerous"] })
        const passwordBox = new Gtk.Box({ spacing: 4, visible: false, cssClasses: ["popover-item"] })
        passwordBox.append(passwordEntry)
        passwordBox.append(submitBtn)
        passwordBox.append(cancelBtn)

        const rowStatus = new Gtk.Label({ label: "", cssClasses: ["bt-status-error"], visible: false, xalign: 0 })

        const wrap = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2, visible: false })
        wrap.append(displayBtn)
        wrap.append(passwordBox)
        wrap.append(rowStatus)

        const slot = {
            wrap, displayBtn, nameLabel, signalIcon, lockIcon, activeMark,
            passwordBox, passwordEntry, submitBtn, cancelBtn, rowStatus,
            bssid: "", editing: false, busy: false,
        }

        const setError = (msg: string) => {
            slot.rowStatus.label = msg
            slot.rowStatus.visible = true
        }
        const clearError = () => { slot.rowStatus.visible = false }

        const enterPasswordMode = () => {
            slot.editing = true
            displayBtn.visible = false
            passwordBox.visible = true
            passwordEntry.set_text("")
            passwordEntry.grab_focus()
        }
        const exitPasswordMode = () => {
            slot.editing = false
            displayBtn.visible = true
            passwordBox.visible = false
            clearError()
        }

        const attemptConnect = async (password?: string) => {
            if (!slot.bssid || slot.busy) return
            slot.busy = true
            displayBtn.sensitive = false
            submitBtn.sensitive = false
            clearError()
            const res = await tryConnectWifi(slot.bssid, password)
            slot.busy = false
            displayBtn.sensitive = true
            submitBtn.sensitive = true
            if (res.ok) {
                exitPasswordMode()
            } else if (res.needsPassword) {
                enterPasswordMode()
            } else if (slot.editing) {
                setError("Contraseña incorrecta o falló la conexión")
            } else {
                setError("No se pudo conectar")
            }
        }

        displayBtn.connect("clicked", () => attemptConnect())
        submitBtn.connect("clicked", () => attemptConnect(passwordEntry.get_text()))
        passwordEntry.connect("activate", () => attemptConnect(passwordEntry.get_text()))
        cancelBtn.connect("clicked", exitPasswordMode)

        return slot
    }
    const wifiSlots = Array.from({ length: WIFI_SLOTS }, makeWifiSlot)
    // Ocupa el hueco de la lista (alto fijo: si el popover cambiara de
    // tamaño abierto, Hyprland lo cerraría)
    const wifiEmpty = new Gtk.Label({ cssClasses: ["popover-empty"], vexpand: true, valign: Gtk.Align.CENTER, heightRequest: 120 })

    const updateWifiList = () => {
        // Orden estable por SSID: si se ordenara por posición de escaneo,
        // los slots (con estado de edición propio) podrían terminar
        // representando una red distinta entre un refresh y otro.
        const aps = [...(network.wifiDevice?.access_points || [])]
            .filter(ap => ap.ssid)
            .sort((a, b) => a.ssid.localeCompare(b.ssid))
            .slice(0, wifiSlots.length)
        const activeSsid = network.wifiDevice?.ssid || ""

        wifiEmpty.visible = aps.length === 0
        wifiEmpty.label = !network.wifiEnabled ? "Wi-Fi apagado" : isRefreshing ? "Buscando…" : "No hay redes Wi-Fi cerca"

        wifiSlots.forEach((slot, i) => {
            const ap: AccessPoint | undefined = aps[i]
            if (!ap) {
                slot.wrap.visible = false
                slot.bssid = ""
                return
            }
            slot.wrap.visible = true
            slot.bssid = ap.bssid
            // No pisar una fila donde el usuario está escribiendo la
            // contraseña o ya se disparó un intento de conexión.
            if (slot.editing || slot.busy) return
            slot.nameLabel.label = ap.ssid
            slot.signalIcon.iconName = ap.iconName
            slot.lockIcon.visible = ap.security > 0
            slot.activeMark.visible = ap.ssid === activeSsid
        })
    }

    const updateStatus = () => {
        const primary = network.primary
        const isConnected = network.connectivity === Connectivity.FULL

        icon.iconName = isConnected
            ? (primary?.type === "WIFI" ? (primary.wifi?.iconName || "network-wireless-symbolic") : "network-wired-symbolic")
            : "network-offline-symbolic"

        statusIcon.iconName = icon.iconName
        const isWifi = primary?.type === "WIFI"
        statusLabel.label = isConnected ? (isWifi ? (primary.wifi?.ssid || "Wi-Fi") : "Ethernet") : "Sin conexión"
        statusSub.label = "Conectado"
        statusSub.visible = isConnected
        isConnected ? statusIconBox.add_css_class("on") : statusIconBox.remove_css_class("on")
    }

    let isRefreshing = false
    let refreshStopId = 0

    // Corta el spinner/timer de la búsqueda actual, si hay una. Se usa
    // tanto al cumplirse la duración fija como al apagar el Wi-Fi a mitad
    // de una búsqueda (si no, el ícono de carga se quedaba pegado).
    const stopRefresh = () => {
        if (!isRefreshing) return
        isRefreshing = false
        refreshSpinner.visible = false
        refreshSpinner.spinning = false
        refreshIcon.visible = true
        updateWifiList()
        if (refreshStopId) { GLib.source_remove(refreshStopId); refreshStopId = 0 }
    }

    refreshBtn.connect("clicked", () => {
        if (isRefreshing || !network.wifiEnabled) return
        isRefreshing = true
        refreshSpinner.visible = true
        refreshSpinner.spinning = true
        refreshIcon.visible = false
        updateWifiList()
        network.wifiDevice?.scan()
        execAsync(["nmcli", "device", "wifi", "rescan"]).catch(() => { })

        // El rescan de nmcli solo dispara el escaneo y vuelve, no espera a
        // que termine — por eso el ícono de carga se sostiene una duración
        // fija en vez de apagarse apenas ese comando resuelve.
        refreshStopId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WIFI_SCAN_DURATION_MS, () => {
            refreshStopId = 0
            updateWifiList()
            stopRefresh()
            return GLib.SOURCE_REMOVE
        })
    })

    let syncingWifiSwitch = false
    const updateWifiSwitch = () => {
        syncingWifiSwitch = true
        wifiSwitch.set_active(!!network.wifiEnabled)
        syncingWifiSwitch = false
        refreshBtn.sensitive = !!network.wifiEnabled
        if (!network.wifiEnabled) stopRefresh()
    }
    wifiSwitch.connect("notify::active", () => {
        if (syncingWifiSwitch) return
        network.setWifiEnabled(wifiSwitch.active)
        if (wifiSwitch.active) network.wifiDevice?.scan()
    })

    const listBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2 })
    listBox.append(wifiEmpty)
    wifiSlots.forEach(s => listBox.append(s.wrap))

    // El alto lo da .topbar-menu.tall: la lista se estira y lo dinámico
    // queda adentro (si el popover cambiara de tamaño, Hyprland lo cerraría)
    const scrolled = new Gtk.ScrolledWindow({
        heightRequest: 100,
        vexpand: true,
        hscrollbarPolicy: Gtk.PolicyType.NEVER,
        child: listBox,
    })

    const wifiSection = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2, vexpand: true })
    wifiSection.append(wifiRow)
    wifiSection.append(scrolled)

    const popover = MenuPopover(menubutton, [
        { title: "Red", titleIcon: "network-workgroup-symbolic", customChild: statusRow },
        { customChild: wifiSection },
    ])
    menubutton.set_popover(popover)

    network.connect("notify::primary", updateStatus)
    network.connect("notify::connectivity", updateStatus)
    network.connect("notify::wifi-enabled", () => { updateWifiSwitch(); updateWifiList() })
    if (network.wifiDevice) network.wifiDevice.connect("notify::access-points", updateWifiList)

    updateStatus()
    updateWifiSwitch()
    updateWifiList()
    popover.add_css_class("topbar-menu")  // mismo ancho que los demás menús de la barra
    popover.add_css_class("tall")  // mismo alto que el portapapeles
    return menubutton
}
