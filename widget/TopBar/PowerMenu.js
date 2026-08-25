import { jsx as _jsx, jsxs as _jsxs } from "ags/gtk4/jsx-runtime";
import { Gtk } from "ags/gtk4";
import { execAsync } from "ags/process";
export default function PowerMenu() {
    return (_jsxs("menubutton", { children: [_jsx("image", { iconName: "system-shutdown-symbolic" }), _jsx("popover", { children: _jsxs("box", { orientation: Gtk.Orientation.VERTICAL, spacing: 6, children: [_jsx("button", { onClicked: () => execAsync("systemctl poweroff"), children: _jsx("label", { label: "Apagar" }) }), _jsx("button", { onClicked: () => execAsync("systemctl reboot"), children: _jsx("label", { label: "Reiniciar" }) }), _jsx("button", { onClicked: () => execAsync("systemctl suspend"), children: _jsx("label", { label: "Suspender" }) }), _jsx("button", { onClicked: () => execAsync("hyprctl dispatch exit"), children: _jsx("label", { label: "Cerrar sesi\u00F3n" }) })] }) })] }));
}
