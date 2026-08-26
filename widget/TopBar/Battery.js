import { Gtk } from "ags/gtk4";
import Battery from "../../lib/battery";
const battery = Battery.get_default();
export default function BatteryIndicator() {
    // Crear widgets nativos
    const box = new Gtk.Box({ spacing: 4 });
    const icon = new Gtk.Image();
    const label = new Gtk.Label();
    box.append(icon);
    box.append(label);
    const update = () => {
        // Solo mostrar si la batería está presente
        box.visible = battery.isPresent;
        icon.iconName = battery.iconName || "battery-missing-symbolic";
        label.label = battery.isPresent ? `${Math.floor(battery.percentage * 100)}%` : "";
    };
    // Conectar cambios
    battery.connect("notify::percentage", update);
    battery.connect("notify::icon-name", update);
    battery.connect("notify::is-present", update);
    // Llamar update cuando el widget esté visible
    box.connect("map", update);
    return box;
}
