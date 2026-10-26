import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"

// Reiniciar y apagar piden un segundo clic: el primero arma el botón (se
// pone rojo y cambia el ícono) y, si no llega el segundo en ARM_MS, se
// desarma solo. Un clic suelto apagaba la PC sin querer.
const ARM_MS = 3000

function confirmTwice(button: Gtk.Button, label: string, action: () => void) {
    // El ícono se busca al usarlo: con $= el hijo puede no estar puesto aún.
    const image = () => button.get_child() as Gtk.Image
    let icon = ""
    let tooltip = ""
    let armedId = 0
    const disarm = () => {
        if (armedId) GLib.source_remove(armedId)
        armedId = 0
        if (!button.has_css_class("armed")) return
        button.remove_css_class("armed")
        image().iconName = icon
        button.tooltipText = tooltip
    }
    button.connect("clicked", () => {
        if (armedId) {
            disarm()
            action()
            return
        }
        icon = image().iconName ?? ""
        tooltip = button.tooltipText ?? ""
        button.add_css_class("armed")
        image().iconName = "dialog-warning-symbolic"
        button.tooltipText = `Clic otra vez para ${label}`
        armedId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ARM_MS, () => {
            armedId = 0
            disarm()
            return GLib.SOURCE_REMOVE
        })
    })
    // Al cerrar el menú (o salir del botón) no debe quedar armado.
    button.connect("unmap", disarm)
}

export default function PowerActions() {
    const logout = () => {
        execAsync(["hyprctl", "dispatch", "hl.dsp.exit()"]).catch(() => {
            execAsync("pkill -u $USER").catch(() => { })
        })
    }

    const reboot = () => {
        execAsync("systemctl reboot").catch(() => { })
    }

    const shutdown = () => {
        execAsync("systemctl poweroff").catch(() => { })
    }

    return (
        <box
            orientation={Gtk.Orientation.HORIZONTAL}
            cssClasses={["power-actions"]}
            homogeneous={true}
            spacing={4}
        >
            <button
                cssClasses={["power-button", "logout-button"]}
                onClicked={logout}
                hexpand={true}
                tooltipText="Cerrar Sesión"
            >
                <image iconName="system-log-out-symbolic" />
            </button>

            <button
                $={(btn: Gtk.Button) => confirmTwice(btn, "reiniciar", reboot)}
                cssClasses={["power-button", "reboot-button"]}
                hexpand={true}
                tooltipText="Reiniciar"
            >
                <image iconName="system-reboot-symbolic" />
            </button>

            <button
                $={(btn: Gtk.Button) => confirmTwice(btn, "apagar", shutdown)}
                cssClasses={["power-button", "shutdown-button"]}
                hexpand={true}
                tooltipText="Apagar"
            >
                <image iconName="system-shutdown-symbolic" />
            </button>
        </box>
    )
}
