import { Gtk } from "ags/gtk4";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Bluetooth from "../../lib/bluetooth";
import { MenuPopover } from "../Shared/MenuPopover";
const DEVICES_FILE = `${GLib.get_home_dir()}/.config/ags/bt-devices.json`;
const loadDevices = () => {
    try {
        const file = Gio.File.new_for_path(DEVICES_FILE);
        const [, contents] = file.load_contents(null);
        return JSON.parse(new TextDecoder().decode(contents));
    }
    catch {
        return [];
    }
};
const saveDevice = (dev) => {
    try {
        const devices = loadDevices();
        if (!devices.find(d => d.address === dev.address)) {
            devices.push(dev);
            const file = Gio.File.new_for_path(DEVICES_FILE);
            file.replace_contents(new TextEncoder().encode(JSON.stringify(devices, null, 2)), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        }
    }
    catch (e) {
        print(`error guardando dispositivo: ${e}`);
    }
};
export default function BluetoothIndicator() {
    const bt = Bluetooth.get_default();
    if (!bt)
        return new Gtk.Box();
    const icon = new Gtk.Image();
    const menubutton = new Gtk.MenuButton({ child: icon });
    const toggleLabel = new Gtk.Label({ label: "", hexpand: true, xalign: 0 });
    let isScanning = false;
    // Slot conectado actualmente
    const connectedIcon = new Gtk.Image({ iconName: "bluetooth-symbolic" });
    const connectedName = new Gtk.Label({ label: "", halign: Gtk.Align.START, hexpand: true });
    const connectedInner = new Gtk.Box({ spacing: 8, cssClasses: ["popover-item"] });
    connectedInner.append(connectedIcon);
    connectedInner.append(connectedName);
    connectedInner.append(new Gtk.Label({ label: "●", cssClasses: ["bt-connected"] }));
    const connectedBtn = new Gtk.Button({ child: connectedInner, cssClasses: ["flat"], visible: false });
    // Slots para anteriormente conectados (del JSON)
    const savedSectionLabel = new Gtk.Label({
        label: "Anteriores",
        xalign: 0,
        cssClasses: ["popover-section-title"],
        visible: false,
    });
    const makeSlot = () => {
        const slotIcon = new Gtk.Image({ iconName: "bluetooth-symbolic" });
        const slotName = new Gtk.Label({ label: "", halign: Gtk.Align.START, hexpand: true });
        const inner = new Gtk.Box({ spacing: 8, cssClasses: ["popover-item"] });
        inner.append(slotIcon);
        inner.append(slotName);
        const btn = new Gtk.Button({ child: inner, cssClasses: ["flat"], visible: false });
        return { btn, slotIcon, slotName, address: "" };
    };
    const savedSlots = Array.from({ length: 10 }, makeSlot);
    // Botón buscar
    const scanSpinner = new Gtk.Spinner({ visible: false });
    const scanBtn = new Gtk.Button({
        cssClasses: ["popover-item"],
        child: (() => {
            const b = new Gtk.Box({ spacing: 8 });
            b.append(new Gtk.Image({ iconName: "network-wireless-acquiring-symbolic" }));
            b.append(new Gtk.Label({ label: "Buscar", hexpand: true, xalign: 0 }));
            b.append(scanSpinner);
            return b;
        })()
    });
    // Slots para dispositivos del scan
    const scanSectionLabel = new Gtk.Label({
        label: "Disponibles",
        xalign: 0,
        cssClasses: ["popover-section-title"],
        visible: false,
    });
    const makeScanSlot = () => {
        const slotIcon = new Gtk.Image({ iconName: "bluetooth-symbolic" });
        const slotName = new Gtk.Label({ label: "", halign: Gtk.Align.START, hexpand: true });
        const connectBtn = new Gtk.Button({ label: "Conectar", cssClasses: ["suggested-action"] });
        const inner = new Gtk.Box({ spacing: 8 });
        inner.append(slotIcon);
        inner.append(slotName);
        inner.append(connectBtn);
        const row = new Gtk.Box({ visible: false });
        row.append(inner);
        return { row, slotIcon, slotName, connectBtn, address: "" };
    };
    const scanSlots = Array.from({ length: 5 }, makeScanSlot);
    const getConnectedAddress = () => (bt.devices || []).find((d) => d.connected)?.address;
    const updateConnected = () => {
        const connected = (bt.devices || []).find((d) => d.connected);
        if (connected) {
            connectedIcon.iconName = connected.icon || "bluetooth-symbolic";
            connectedName.label = connected.name || connected.address;
            connectedBtn.visible = true;
            saveDevice({
                name: connected.name || connected.address,
                address: connected.address,
                icon: connected.icon || "bluetooth-symbolic"
            });
        }
        else {
            connectedBtn.visible = false;
        }
        connectedBtn.connect("clicked", () => {
            if (connected)
                connected.disconnect_device(null);
        });
    };
    const updateSavedSlots = () => {
        const saved = loadDevices();
        const connectedAddress = getConnectedAddress();
        const filtered = saved.filter(d => d.address !== connectedAddress);
        savedSectionLabel.visible = filtered.length > 0;
        savedSlots.forEach((slot, i) => {
            const dev = filtered[i];
            if (dev) {
                slot.slotIcon.iconName = dev.icon || "bluetooth-symbolic";
                slot.slotName.label = dev.name || dev.address;
                slot.address = dev.address;
                slot.btn.visible = true;
                slot.btn.connect("clicked", () => {
                    try {
                        Gio.Subprocess.new(["bluetoothctl", "connect", dev.address], Gio.SubprocessFlags.NONE);
                    }
                    catch (e) {
                        print(`error conectando: ${e}`);
                    }
                });
            }
            else {
                slot.btn.visible = false;
            }
        });
    };
    const updateScanSlots = (discovered) => {
        const savedAddresses = new Set(loadDevices().map(d => d.address));
        const connectedAddress = getConnectedAddress();
        const available = [...discovered.values()].filter(d => !savedAddresses.has(d.address) && d.address !== connectedAddress);
        scanSectionLabel.visible = available.length > 0;
        scanSlots.forEach((slot, i) => {
            const dev = available[i];
            if (dev) {
                slot.slotIcon.iconName = dev.icon || "bluetooth-symbolic";
                slot.slotName.label = dev.name || dev.address;
                slot.address = dev.address;
                slot.row.visible = true;
                slot.connectBtn.connect("clicked", () => {
                    slot.connectBtn.sensitive = false;
                    try {
                        const proc = Gio.Subprocess.new(["bluetoothctl", "pair", dev.address], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE);
                        proc.wait_async(null, (_, res) => {
                            proc.wait_finish(res);
                            // Esperar un momento antes de conectar
                            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                                try {
                                    Gio.Subprocess.new(["bluetoothctl", "connect", dev.address], Gio.SubprocessFlags.NONE);
                                    saveDevice(dev);
                                    updateSavedSlots();
                                    updateScanSlots(discovered);
                                }
                                catch (e) {
                                    print(`error conectando: ${e}`);
                                }
                                slot.connectBtn.sensitive = true;
                                return GLib.SOURCE_REMOVE;
                            });
                        });
                    }
                    catch (e) {
                        print(`error emparejando: ${e}`);
                        slot.connectBtn.sensitive = true;
                    }
                });
            }
            else {
                slot.row.visible = false;
            }
        });
    };
    scanBtn.connect("clicked", () => {
        if (isScanning)
            return;
        isScanning = true;
        scanSpinner.visible = true;
        scanSpinner.spinning = true;
        const discovered = new Map();
        const adapter = bt.adapter;
        if (!adapter)
            return;
        adapter.start_discovery();
        const handlerId = bt.connect("notify::devices", () => {
            for (const dev of bt.devices || []) {
                discovered.set(dev.address, {
                    name: dev.name || dev.address,
                    address: dev.address,
                    icon: dev.icon || "bluetooth-symbolic"
                });
            }
            updateScanSlots(discovered);
        });
        const pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            let changed = false;
            for (const dev of bt.devices || []) {
                if (!discovered.has(dev.address)) {
                    discovered.set(dev.address, {
                        name: dev.name || dev.address,
                        address: dev.address,
                        icon: dev.icon || "bluetooth-symbolic"
                    });
                    changed = true;
                }
            }
            if (changed)
                updateScanSlots(discovered);
            return GLib.SOURCE_CONTINUE;
        });
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 15000, () => {
            adapter.stop_discovery();
            bt.disconnect(handlerId);
            GLib.source_remove(pollId);
            isScanning = false;
            scanSpinner.visible = false;
            scanSpinner.spinning = false;
            return GLib.SOURCE_REMOVE;
        });
    });
    const listBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2 });
    listBox.append(connectedBtn);
    listBox.append(savedSectionLabel);
    savedSlots.forEach(s => listBox.append(s.btn));
    listBox.append(scanSectionLabel);
    scanSlots.forEach(s => listBox.append(s.row));
    const scrolled = new Gtk.ScrolledWindow({
        heightRequest: 4 * 44,
        widthRequest: 220,
        child: listBox,
    });
    const popover = MenuPopover(menubutton, [
        {
            title: "Bluetooth",
            customChild: (() => {
                const row = new Gtk.Box({ spacing: 4 });
                const toggleBtn = new Gtk.Button({
                    cssClasses: ["popover-item"],
                    hexpand: true,
                    child: (() => {
                        const b = new Gtk.Box({ spacing: 8 });
                        b.append(new Gtk.Image({ iconName: "system-shutdown-symbolic" }));
                        b.append(toggleLabel);
                        return b;
                    })()
                });
                toggleBtn.connect("clicked", () => bt.toggle());
                row.append(toggleBtn);
                row.append(scanBtn);
                return row;
            })()
        },
        { customChild: scrolled }
    ]);
    menubutton.set_popover(popover);
    const update = () => {
        icon.iconName = bt.isPowered ? "bluetooth-active-symbolic" : "bluetooth-disabled-symbolic";
        toggleLabel.label = bt.isPowered ? "Desactivar" : "Activar";
        updateConnected();
        updateSavedSlots();
    };
    bt.connect("notify::is-powered", update);
    bt.connect("notify::devices", update);
    update();
    return menubutton;
}
