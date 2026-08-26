import { jsx as _jsx, jsxs as _jsxs } from "ags/gtk4/jsx-runtime";
import { Gtk } from "ags/gtk4";
import Network from "../../lib/network";
const network = Network.get_default();
export default function InternetToggle() {
    const label = new Gtk.Label({
        cssClasses: ["toggle-detail"],
        halign: Gtk.Align.START,
        hexpand: true
    });
    const icon = new Gtk.Image({
        cssClasses: ["toggle-icon", "white-icon"]
    });
    const update = () => {
        const wifi = network.wifi;
        if (wifi) {
            label.label = wifi.ssid || "WiFi Conectado";
            icon.icon_name = network.connectivity === Network.Connectivity.FULL ? "network-wireless-signal-excellent-symbolic" : "network-wireless-offline-symbolic";
        }
        else if (network.wired) {
            label.label = "Ethernet";
            icon.icon_name = "network-wired-symbolic";
        }
        else {
            label.label = "Desconectado";
            icon.icon_name = "network-offline-symbolic";
        }
    };
    network.connect("notify::wifi", update);
    network.connect("notify::wired", update);
    update();
    return (_jsx("button", { cssClasses: ["quick-settings-item"], onClicked: () => network.wifi?.scan(), hexpand: true, children: _jsxs("box", { spacing: 12, children: [icon, label, _jsx("label", { label: "\uF105", cssClasses: ["toggle-arrow"] })] }) }));
}
