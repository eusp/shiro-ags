import { Gtk } from "ags/gtk4"
import Network from "../../lib/network"
import { execAsync } from "ags/process"
import { MenuPopover } from "../Shared/MenuPopover"

const network = Network.get_default()
const { Connectivity } = Network

export default function NetworkIndicator() {
    const icon = new Gtk.Image()
    const menubutton = new Gtk.MenuButton()
    menubutton.set_child(icon)

    const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4 })
    const statusLabel = new Gtk.Label({ xalign: 0, cssClasses: ["popover-item"] })

    // --- CORRECCIÓN AQUÍ ---
    const refreshBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5 })
    refreshBox.append(new Gtk.Image({ iconName: "view-refresh-symbolic" }))
    refreshBox.append(new Gtk.Label({ label: "Actualizar" }))

    const refreshBtn = new Gtk.Button({
        cssClasses: ["popover-item"],
        child: refreshBox // Asignamos el box ya poblado
    })
    // -----------------------

    const wifiList = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2 })

    container.append(statusLabel)
    container.append(refreshBtn)
    container.append(new Gtk.Separator({ cssClasses: ["popover-separator"] }))
    container.append(wifiList)

    const updateUI = () => {
        const primary = network.primary
        const isConnected = network.connectivity === Connectivity.FULL

        icon.iconName = isConnected ? (primary?.type === "WIFI" ? (primary.wifi.iconName || "network-wireless-symbolic") : "network-wired-symbolic") : "network-offline-symbolic"
        statusLabel.label = isConnected ? (primary?.type === "WIFI" ? `Conectado: ${primary.wifi.ssid}` : "Ethernet Conectado") : "Sin conexión"

        while (wifiList.get_first_child()) wifiList.remove(wifiList.get_first_child()!)

        if (network.wifi) {
            network.wifi.access_points.slice(0, 6).forEach(ap => {
                const btnContent = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 10 })
                btnContent.append(new Gtk.Label({ label: ap.security > 0 ? "󰌾" : "󰖩" }))
                btnContent.append(new Gtk.Label({ label: ap.ssid || "Red oculta", xalign: 0, hexpand: true }))

                const btn = new Gtk.Button({ cssClasses: ["popover-item"], child: btnContent })

                btn.connect("clicked", () => {
                    execAsync(`nmcli device wifi connect "${ap.bssid}"`)
                        .catch(() => execAsync("nm-connection-editor"))
                    popover.popdown()
                })
                wifiList.append(btn)
            })
        }
    }

    refreshBtn.connect("clicked", () => {
        execAsync("nmcli device wifi rescan").then(() => updateUI())
    })

    const popover = MenuPopover(menubutton, [{ title: "Red", customChild: container }])
    menubutton.set_popover(popover)

    network.connect("notify::primary", updateUI)
    network.connect("notify::connectivity", updateUI)
    if (network.wifi) network.wifi.connect("notify::access-points", updateUI)

    updateUI()
    return menubutton
}