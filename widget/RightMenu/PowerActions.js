import { jsx as _jsx, jsxs as _jsxs } from "ags/gtk4/jsx-runtime";
import { Gtk } from "ags/gtk4";
import { execAsync } from "ags/process";
export default function PowerActions() {
    const logout = () => {
        execAsync(["hyprctl", "dispatch", "hl.dsp.exit()"]).catch(() => {
            execAsync("pkill -u $USER").catch(() => { });
        });
    };
    const reboot = () => {
        execAsync("systemctl reboot").catch(() => { });
    };
    const shutdown = () => {
        execAsync("systemctl poweroff").catch(() => { });
    };
    return (_jsxs("box", { orientation: Gtk.Orientation.HORIZONTAL, cssClasses: ["power-actions"], homogeneous: true, spacing: 4, children: [_jsx("button", { cssClasses: ["power-button", "logout-button"], onClicked: logout, hexpand: true, tooltipText: "Cerrar Sesi\u00F3n", children: _jsx("image", { iconName: "system-log-out-symbolic" }) }), _jsx("button", { cssClasses: ["power-button", "reboot-button"], onClicked: reboot, hexpand: true, tooltipText: "Reiniciar", children: _jsx("image", { iconName: "system-reboot-symbolic" }) }), _jsx("button", { cssClasses: ["power-button", "shutdown-button"], onClicked: shutdown, hexpand: true, tooltipText: "Apagar", children: _jsx("image", { iconName: "system-shutdown-symbolic" }) })] }));
}
