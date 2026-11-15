import { Gtk } from "ags/gtk4"
import ClockWeather from "./ClockWeather"
import BrightnessControl from "./BrightnessControl"

// Red, Bluetooth, volumen y micrófono se manejan desde la topbar.
// El brillo solo aparece si hay pantalla con backlight (laptop).
export function QuickSettingsList() {
    return (
        <box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={["quick-settings-list"]}
            spacing={4}
        >
            <BrightnessControl />
        </box>
    )
}

export default function QuickSettings() {
    return (
        <box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={["quick-settings"]}
            spacing={16}
        >
            <ClockWeather />
            <QuickSettingsList />
        </box>
    )
}
