import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"

export default function PowerMenu() {
    return (
        <menubutton>
            <image iconName="system-shutdown-symbolic" />
            <popover>
                <box orientation={Gtk.Orientation.VERTICAL} spacing={6}>
                    <button onClicked={() => execAsync("systemctl poweroff")}>
                        <label label="Apagar" />
                    </button>
                    <button onClicked={() => execAsync("systemctl reboot")}>
                        <label label="Reiniciar" />
                    </button>
                    <button onClicked={() => execAsync("systemctl suspend")}>
                        <label label="Suspender" />
                    </button>
                    <button onClicked={() => execAsync(["hyprctl", "dispatch", "hl.dsp.exit()"])}>
                        <label label="Cerrar sesión" />
                    </button>
                </box>
            </popover>
        </menubutton>
    )
}
