import { jsx as _jsx } from "ags/gtk4/jsx-runtime";
import GLib from "gi://GLib?version=2.0";
import { exec, execAsync } from "ags/process";
export default function PowerProfile() {
    const profiles = {
        "power-saver": { icon: "power-profile-power-saver-symbolic", class: "btn-saver", label: "Ahorro" },
        "balanced": { icon: "power-profile-balanced-symbolic", class: "btn-balanced", label: "Balanceado" },
        "performance": { icon: "power-profile-performance-symbolic", class: "btn-performance", label: "Alto" },
    };
    const button = (_jsx("button", { cssClasses: ["power-btn"] }));
    const image = (_jsx("image", {}));
    button.child = image;
    const update = () => {
        try {
            const current = exec("powerprofilesctl get").trim();
            const info = profiles[current] || profiles["balanced"];
            button.cssClasses = ["power-btn", info.class];
            button.tooltipText = `Modo: ${info.label}`;
            image.iconName = info.icon;
        }
        catch (e) {
            // @ts-ignore
            print(e);
        }
    };
    button.connect("clicked", () => {
        const current = exec("powerprofilesctl get").trim();
        const next = current === "power-saver" ? "balanced" : (current === "balanced" ? "performance" : "power-saver");
        execAsync(`powerprofilesctl set ${next}`).then(() => update());
    });
    // Update every 2 seconds
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        update();
        return GLib.SOURCE_CONTINUE;
    });
    update();
    return button;
}
