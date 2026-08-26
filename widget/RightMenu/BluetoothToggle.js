import { jsx as _jsx, jsxs as _jsxs } from "ags/gtk4/jsx-runtime";
import { Gtk } from "ags/gtk4";
import Bluetooth from "../../lib/bluetooth";
const bluetooth = Bluetooth.get_default();
export default function BluetoothToggle() {
    const label = new Gtk.Label({
        cssClasses: ["toggle-detail"],
        halign: Gtk.Align.START,
        hexpand: true
    });
    const icon = new Gtk.Image({
        cssClasses: ["toggle-icon", "white-icon"]
    });
    const update = () => {
        if (bluetooth.adapter) {
            label.label = bluetooth.adapter.powered ? "Bluetooth" : "Apagado";
            icon.icon_name = bluetooth.adapter.powered ? "bluetooth-active-symbolic" : "bluetooth-disabled-symbolic";
        }
        else {
            label.label = "No disponible";
            icon.icon_name = "bluetooth-disabled-symbolic";
        }
    };
    bluetooth.connect("notify::adapter", update);
    if (bluetooth.adapter)
        bluetooth.adapter.connect("notify::powered", update);
    update();
    return (_jsx("button", { cssClasses: ["quick-settings-item"], onClicked: () => bluetooth.adapter?.set_powered(!bluetooth.adapter.powered), hexpand: true, children: _jsxs("box", { spacing: 12, children: [icon, label, _jsx("label", { label: "\uF105", cssClasses: ["toggle-arrow"] })] }) }));
}
