var _a;
// Lightweight stand-in for AstalBluetooth: talks to bluez over D-Bus
// directly instead of relying on astal's native binding (only available
// bundled with an old, unrelated astal-libs build that drifts out of sync
// with the system's actual astal version).
import GObject from "gi://GObject";
import GLib from "gi://GLib?version=2.0";
import Gio from "gi://Gio?version=2.0";
const BLUEZ_BUS = "org.bluez";
const ADAPTER_IFACE = "org.bluez.Adapter1";
const DEVICE_IFACE = "org.bluez.Device1";
function proxy(path, iface) {
    return Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null, BLUEZ_BUS, path, iface, null);
}
function readProp(p, name) {
    const v = p?.get_cached_property(name);
    return v ? v.deep_unpack() : null;
}
function setRemoteProperty(p, iface, name, variant) {
    p.get_connection().call(p.get_name(), p.get_object_path(), "org.freedesktop.DBus.Properties", "Set", new GLib.Variant("(ssv)", [iface, name, variant]), null, Gio.DBusCallFlags.NONE, -1, null, null);
}
export class Device {
    constructor(path) {
        this.address = "";
        this.name = "";
        this.icon = "bluetooth-symbolic";
        this.connected = false;
        this.path = path;
        this.proxy = proxy(path, DEVICE_IFACE);
        this.refresh();
    }
    refresh() {
        this.address = readProp(this.proxy, "Address") || "";
        this.name = readProp(this.proxy, "Name") || readProp(this.proxy, "Alias") || this.address;
        this.icon = readProp(this.proxy, "Icon") || "bluetooth-symbolic";
        this.connected = readProp(this.proxy, "Connected") || false;
    }
    disconnect_device(_arg) {
        try {
            this.proxy.call("Disconnect", null, Gio.DBusCallFlags.NONE, -1, null, null);
        }
        catch (e) {
            logError(e, "bluetooth: disconnect failed");
        }
    }
}
const Adapter = GObject.registerClass({
    GTypeName: "ShiroBtAdapter",
    Properties: {
        powered: GObject.ParamSpec.jsobject("powered", "", "", GObject.ParamFlags.READABLE),
    },
}, class Adapter extends GObject.Object {
    constructor(path) {
        super();
        this._powered = false;
        this.path = path;
        this._proxy = proxy(path, ADAPTER_IFACE);
        this._proxy.connect("g-properties-changed", () => this._refresh());
        this._refresh();
    }
    get powered() {
        return this._powered;
    }
    set_powered(value) {
        setRemoteProperty(this._proxy, ADAPTER_IFACE, "Powered", new GLib.Variant("b", value));
    }
    start_discovery() {
        try {
            this._proxy.call("StartDiscovery", null, Gio.DBusCallFlags.NONE, -1, null, null);
        }
        catch (e) {
            logError(e, "bluetooth: start_discovery failed");
        }
    }
    stop_discovery() {
        try {
            this._proxy.call("StopDiscovery", null, Gio.DBusCallFlags.NONE, -1, null, null);
        }
        catch (e) {
            logError(e, "bluetooth: stop_discovery failed");
        }
    }
    _refresh() {
        this._powered = readProp(this._proxy, "Powered") || false;
        this.notify("powered");
    }
});
const Bluetooth = GObject.registerClass({
    GTypeName: "ShiroBluetooth",
    Properties: {
        devices: GObject.ParamSpec.jsobject("devices", "", "", GObject.ParamFlags.READABLE),
        adapter: GObject.ParamSpec.jsobject("adapter", "", "", GObject.ParamFlags.READABLE),
        "is-powered": GObject.ParamSpec.jsobject("is-powered", "", "", GObject.ParamFlags.READABLE),
    },
}, (_a = class Bluetooth extends GObject.Object {
        static get_default() {
            if (!_a._instance)
                _a._instance = new _a();
            return _a._instance;
        }
        constructor() {
            super();
            this._devices = new Map();
            this._adapter = null;
            // Deferred so BlueZ's synchronous GetManagedObjects call doesn't
            // block the UI from becoming interactive at startup.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._connect();
                return GLib.SOURCE_REMOVE;
            });
        }
        get devices() {
            return Array.from(this._devices.values());
        }
        get adapter() {
            return this._adapter;
        }
        get isPowered() {
            return this._adapter?.powered ?? false;
        }
        toggle() {
            if (this._adapter)
                this._adapter.set_powered(!this._adapter.powered);
        }
        _addAdapter(path) {
            if (this._adapter)
                return;
            this._adapter = new Adapter(path);
            this._adapter.connect("notify::powered", () => this.notify("is-powered"));
            this.notify("adapter");
            this.notify("is-powered");
        }
        _addDevice(path) {
            if (this._devices.has(path))
                return;
            const device = new Device(path);
            device.proxy.connect("g-properties-changed", () => {
                device.refresh();
                this.notify("devices");
            });
            this._devices.set(path, device);
        }
        _connect() {
            try {
                this._objectManager = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null, BLUEZ_BUS, "/", "org.freedesktop.DBus.ObjectManager", null);
                const result = this._objectManager.call_sync("GetManagedObjects", null, Gio.DBusCallFlags.NONE, -1, null);
                const [objects] = result.recursiveUnpack();
                for (const path in objects) {
                    const ifaces = objects[path];
                    if (ifaces[ADAPTER_IFACE])
                        this._addAdapter(path);
                    if (ifaces[DEVICE_IFACE])
                        this._addDevice(path);
                }
                this.notify("devices");
                const connection = this._objectManager.get_connection();
                connection.signal_subscribe(BLUEZ_BUS, "org.freedesktop.DBus.ObjectManager", "InterfacesAdded", null, null, Gio.DBusSignalFlags.NONE, (_c, _s, _p, _i, _sig, params) => {
                    const [path, ifaces] = params.recursiveUnpack();
                    if (ifaces[ADAPTER_IFACE])
                        this._addAdapter(path);
                    if (ifaces[DEVICE_IFACE]) {
                        this._addDevice(path);
                        this.notify("devices");
                    }
                });
                connection.signal_subscribe(BLUEZ_BUS, "org.freedesktop.DBus.ObjectManager", "InterfacesRemoved", null, null, Gio.DBusSignalFlags.NONE, (_c, _s, _p, _i, _sig, params) => {
                    const [path] = params.deep_unpack();
                    if (this._devices.delete(path))
                        this.notify("devices");
                });
            }
            catch (e) {
                logError(e, "bluetooth: could not connect to bluez");
            }
        }
    },
    _a._instance = null,
    _a));
export default Bluetooth;
