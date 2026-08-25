import { Gtk } from "ags/gtk4";
import GLib from "gi://GLib?version=2.0";
import { MenuPopover } from "../Shared/MenuPopover";
function readFile(path) {
    try {
        const [ok, contents] = GLib.file_get_contents(path);
        if (ok && contents) {
            return new TextDecoder().decode(contents);
        }
    }
    catch { }
    return "";
}
function getCpuUsage() {
    try {
        const lines = readFile("/proc/stat");
        const cpu = lines.split("\n")[0].split(/\s+/).slice(1).map(Number);
        const idle = cpu[3];
        const total = cpu.reduce((a, b) => a + b, 0);
        const usage = ((1 - idle / total) * 100).toFixed(0);
        return `${usage}%`;
    }
    catch {
        return "N/A";
    }
}
function getMemUsage() {
    try {
        const lines = readFile("/proc/meminfo");
        const total = parseInt(lines.match(/MemTotal:\s+(\d+)/)?.[1] || "0");
        const available = parseInt(lines.match(/MemAvailable:\s+(\d+)/)?.[1] || "0");
        const used = total - available;
        const usedMB = (used / 1024).toFixed(0);
        const totalMB = (total / 1024).toFixed(0);
        const pct = ((used / total) * 100).toFixed(0);
        return `${usedMB}/${totalMB} MB (${pct}%)`;
    }
    catch {
        return "N/A";
    }
}
export default function SystemMonitor() {
    const menubutton = new Gtk.MenuButton();
    menubutton.set_child(new Gtk.Image({ iconName: "utilities-system-monitor-symbolic" }));
    const cpuLabel = new Gtk.Label({ xalign: 0, cssClasses: ["popover-label"] });
    const memLabel = new Gtk.Label({ xalign: 0, cssClasses: ["popover-label"] });
    const statsBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 10 });
    const cpuRow = new Gtk.Box({ spacing: 8 });
    cpuRow.append(new Gtk.Image({ iconName: "computer-symbolic", cssClasses: ["dim"] }));
    cpuRow.append(new Gtk.Label({ label: "CPU:", cssClasses: ["dim"] }));
    cpuRow.append(cpuLabel);
    statsBox.append(cpuRow);
    const memRow = new Gtk.Box({ spacing: 8 });
    memRow.append(new Gtk.Image({ iconName: "drive-harddisk-symbolic", cssClasses: ["dim"] }));
    memRow.append(new Gtk.Label({ label: "RAM:", cssClasses: ["dim"] }));
    memRow.append(memLabel);
    statsBox.append(memRow);
    const popover = MenuPopover(menubutton, [
        { title: "Rendimiento", customChild: statsBox }
    ]);
    menubutton.set_popover(popover);
    const update = () => {
        cpuLabel.label = getCpuUsage();
        memLabel.label = getMemUsage();
    };
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        if (popover.visible)
            update();
        return GLib.SOURCE_CONTINUE;
    });
    return menubutton;
}
