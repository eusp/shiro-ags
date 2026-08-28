// Lightweight stand-in for AstalBluetooth: talks to bluez over D-Bus
// directly instead of relying on astal's native binding (only available
// bundled with an old, unrelated astal-libs build that drifts out of sync
// with the system's actual astal version).
import GObject from "gi://GObject"
import GLib from "gi://GLib?version=2.0"
import Gio from "gi://Gio?version=2.0"

// All bluez calls go through the async variants below. bluetoothd can hang
// for several seconds under load (a slow/misbehaving device negotiating a
// profile, a stuck discovery session, etc.) — with the old *_sync calls that
// froze the whole GLib main loop, taking every AGS widget down with it since
// they all share the same loop as GTK. Promisifying keeps every call
// non-blocking: a slow bluetoothd just delays the bluetooth widget, nothing
// else in the shell.
Gio._promisify(Gio.DBusProxy, "new_for_bus", "new_for_bus_finish")
Gio._promisify(Gio.DBusProxy.prototype, "call", "call_finish")

const BLUEZ_BUS = "org.bluez"
const ADAPTER_IFACE = "org.bluez.Adapter1"
const DEVICE_IFACE = "org.bluez.Device1"

async function proxy(path: string, iface: string): Promise<any> {
    return Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null, BLUEZ_BUS, path, iface, null)
}

function readProp(p: any, name: string): any {
    const v = p?.get_cached_property(name)
    return v ? v.deep_unpack() : null
}

function setRemoteProperty(p: any, iface: string, name: string, variant: GLib.Variant) {
    p.get_connection().call(
        p.get_name(),
        p.get_object_path(),
        "org.freedesktop.DBus.Properties",
        "Set",
        new GLib.Variant("(ssv)", [iface, name, variant]),
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
        null,
    )
}

export class Device {
    path: string
    proxy: any = null
    address = ""
    name = ""
    icon = "bluetooth-symbolic"
    connected = false

    constructor(path: string) {
        this.path = path
    }

    async init(onChange: () => void) {
        try {
            this.proxy = await proxy(this.path, DEVICE_IFACE)
            this.refresh()
            this.proxy.connect("g-properties-changed", () => {
                this.refresh()
                onChange()
            })
            onChange()
        } catch (e) {
            logError(e as Error, "bluetooth: failed to create device proxy")
        }
    }

    refresh() {
        this.address = readProp(this.proxy, "Address") || ""
        this.name = readProp(this.proxy, "Name") || readProp(this.proxy, "Alias") || this.address
        this.icon = readProp(this.proxy, "Icon") || "bluetooth-symbolic"
        this.connected = readProp(this.proxy, "Connected") || false
    }

    disconnect_device(_arg?: any) {
        if (!this.proxy) return
        try {
            this.proxy.call("Disconnect", null, Gio.DBusCallFlags.NONE, -1, null, null)
        } catch (e) {
            logError(e as Error, "bluetooth: disconnect failed")
        }
    }
}

const Adapter = GObject.registerClass(
    {
        GTypeName: "ShiroBtAdapter",
        Properties: {
            powered: GObject.ParamSpec.jsobject("powered", "", "", GObject.ParamFlags.READABLE),
        },
    },
    class Adapter extends GObject.Object {
        path: string
        private _proxy: any = null
        private _powered = false

        constructor(path: string) {
            super()
            this.path = path
        }

        async init() {
            try {
                this._proxy = await proxy(this.path, ADAPTER_IFACE)
                this._proxy.connect("g-properties-changed", () => this._refresh())
                this._refresh()
            } catch (e) {
                logError(e as Error, "bluetooth: failed to create adapter proxy")
            }
        }

        get powered() {
            return this._powered
        }

        set_powered(value: boolean) {
            if (!this._proxy) return
            setRemoteProperty(this._proxy, ADAPTER_IFACE, "Powered", new GLib.Variant("b", value))
        }

        start_discovery() {
            if (!this._proxy) return
            try {
                this._proxy.call("StartDiscovery", null, Gio.DBusCallFlags.NONE, -1, null, null)
            } catch (e) {
                logError(e as Error, "bluetooth: start_discovery failed")
            }
        }

        stop_discovery() {
            if (!this._proxy) return
            try {
                this._proxy.call("StopDiscovery", null, Gio.DBusCallFlags.NONE, -1, null, null)
            } catch (e) {
                logError(e as Error, "bluetooth: stop_discovery failed")
            }
        }

        private _refresh() {
            this._powered = readProp(this._proxy, "Powered") || false
            this.notify("powered")
        }
    },
)

const Bluetooth = GObject.registerClass(
    {
        GTypeName: "ShiroBluetooth",
        Properties: {
            devices: GObject.ParamSpec.jsobject("devices", "", "", GObject.ParamFlags.READABLE),
            adapter: GObject.ParamSpec.jsobject("adapter", "", "", GObject.ParamFlags.READABLE),
            "is-powered": GObject.ParamSpec.jsobject("is-powered", "", "", GObject.ParamFlags.READABLE),
        },
    },
    class Bluetooth extends GObject.Object {
        static _instance: InstanceType<typeof Bluetooth> | null = null
        static get_default() {
            if (!Bluetooth._instance) Bluetooth._instance = new Bluetooth()
            return Bluetooth._instance
        }

        private _devices = new Map<string, Device>()
        private _adapter: InstanceType<typeof Adapter> | null = null
        private _objectManager: any

        constructor() {
            super()
            // Deferred so bluez's (now async, but still not instant) startup
            // handshake doesn't delay the UI from becoming interactive.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._connect()
                return GLib.SOURCE_REMOVE
            })
        }

        get devices(): Device[] {
            return Array.from(this._devices.values())
        }

        get adapter() {
            return this._adapter
        }

        get isPowered() {
            return this._adapter?.powered ?? false
        }

        toggle() {
            if (this._adapter) this._adapter.set_powered(!this._adapter.powered)
        }

        private _addAdapter(path: string) {
            if (this._adapter) return
            this._adapter = new Adapter(path)
            this._adapter.connect("notify::powered", () => this.notify("is-powered"))
            this._adapter.init().then(() => {
                this.notify("adapter")
                this.notify("is-powered")
            })
        }

        private _addDevice(path: string) {
            if (this._devices.has(path)) return
            const device = new Device(path)
            this._devices.set(path, device)
            device.init(() => this.notify("devices"))
        }

        private async _connect() {
            try {
                this._objectManager = await Gio.DBusProxy.new_for_bus(
                    Gio.BusType.SYSTEM,
                    Gio.DBusProxyFlags.NONE,
                    null,
                    BLUEZ_BUS,
                    "/",
                    "org.freedesktop.DBus.ObjectManager",
                    null,
                )

                const result = await this._objectManager.call("GetManagedObjects", null, Gio.DBusCallFlags.NONE, -1, null)
                const [objects] = (result as any).recursiveUnpack()

                for (const path in objects) {
                    const ifaces = objects[path]
                    if (ifaces[ADAPTER_IFACE]) this._addAdapter(path)
                    if (ifaces[DEVICE_IFACE]) this._addDevice(path)
                }
                this.notify("devices")

                const connection = this._objectManager.get_connection()

                connection.signal_subscribe(
                    BLUEZ_BUS,
                    "org.freedesktop.DBus.ObjectManager",
                    "InterfacesAdded",
                    null,
                    null,
                    Gio.DBusSignalFlags.NONE,
                    (_c: any, _s: string, _p: string, _i: string, _sig: string, params: GLib.Variant) => {
                        const [path, ifaces] = (params as any).recursiveUnpack()
                        if (ifaces[ADAPTER_IFACE]) this._addAdapter(path)
                        if (ifaces[DEVICE_IFACE]) this._addDevice(path)
                    },
                )

                connection.signal_subscribe(
                    BLUEZ_BUS,
                    "org.freedesktop.DBus.ObjectManager",
                    "InterfacesRemoved",
                    null,
                    null,
                    Gio.DBusSignalFlags.NONE,
                    (_c: any, _s: string, _p: string, _i: string, _sig: string, params: GLib.Variant) => {
                        const [path] = params.deep_unpack() as [string]
                        if (this._devices.delete(path)) this.notify("devices")
                    },
                )
            } catch (e) {
                logError(e as Error, "bluetooth: could not connect to bluez")
            }
        }
    },
)

export default Bluetooth
