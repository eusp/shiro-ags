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

// The @girs types only know the callback form; once promisified, omitting the
// callback returns a Promise. Still called as a method so `this` stays bound.
const DBusProxy = Gio.DBusProxy as unknown as {
    new_for_bus(
        busType: Gio.BusType,
        flags: Gio.DBusProxyFlags,
        info: Gio.DBusInterfaceInfo | null,
        name: string,
        objectPath: string,
        interfaceName: string,
        cancellable: Gio.Cancellable | null,
    ): Promise<Gio.DBusProxy>
}

const BLUEZ_BUS = "org.bluez"
const ADAPTER_IFACE = "org.bluez.Adapter1"
const DEVICE_IFACE = "org.bluez.Device1"
const A2DP_SINK_UUID = "0000110b-0000-1000-8000-00805f9b34fb"

// Espera máxima de las llamadas que negocian con el dispositivo: Connect puede
// pasar de 20 s cuando un perfil (Hands-Free en los M100) no responde.
const DEVICE_CALL_TIMEOUT_MS = 60000

async function proxy(path: string, iface: string): Promise<any> {
    return DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null, BLUEZ_BUS, path, iface, null)
}

function readProp(p: any, name: string): any {
    const v = p?.get_cached_property(name)
    return v ? v.deep_unpack() : null
}

// Registro de Bluetooth con hora al milisegundo; sale por la terminal de `ags run`.
export function btLog(msg: string) {
    const now = GLib.DateTime.new_now_local()
    const ms = String(Math.floor(now.get_microsecond() / 1000)).padStart(3, "0")
    print(`[bt ${now.format("%H:%M:%S")}.${ms}] ${msg}`)
}

// Cambian varias veces por segundo durante una búsqueda y taparían el resto del registro
const NOISY_PROPS = new Set(["RSSI", "TxPower", "ManufacturerData", "ServiceData", "AdvertisingFlags", "AdvertisingData"])

function describeChanges(changed: GLib.Variant): string {
    const props = (changed as any).recursiveUnpack() as Record<string, unknown>
    return Object.entries(props)
        .filter(([k]) => !NOISY_PROPS.has(k))
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(", ")
}

// Resuelve null si salió bien, o el error de BlueZ
function setRemoteProperty(p: any, iface: string, name: string, variant: GLib.Variant): Promise<string | null> {
    const what = `D-Bus Set ${name}=${JSON.stringify(variant.deep_unpack())} en ${p.get_object_path()}`
    btLog(`→ ${what}`)
    return new Promise(resolve => {
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
            (conn: Gio.DBusConnection, res: Gio.AsyncResult) => {
                try {
                    conn.call_finish(res)
                    btLog(`← ${what}: OK`)
                    resolve(null)
                } catch (e) {
                    btLog(`← ${what}: error ${e}`)
                    resolve(String(e))
                }
            },
        )
    })
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
            btLog(`dispositivo registrado: ${this.name} (${this.address}) Connected=${this.connected} Paired=${readProp(this.proxy, "Paired")} Bonded=${readProp(this.proxy, "Bonded")} Trusted=${readProp(this.proxy, "Trusted")}`)
            this.proxy.connect("g-properties-changed", (_p: any, changed: GLib.Variant) => {
                const desc = describeChanges(changed)
                if (desc) btLog(`dispositivo ${this.name} (${this.address}) cambió: ${desc}`)
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

    // Llama a un método de Device1: null si salió bien, o el error que da BlueZ
    private async _call(method: string, params: GLib.Variant | null, label = method): Promise<string | null> {
        if (!this.proxy) return "sin proxy de D-Bus"
        const started = GLib.get_monotonic_time()
        const ms = () => Math.round((GLib.get_monotonic_time() - started) / 1000)
        btLog(`→ D-Bus ${label} ${this.name} (${this.address})`)
        try {
            await this.proxy.call(method, params, Gio.DBusCallFlags.NONE, DEVICE_CALL_TIMEOUT_MS, null)
            btLog(`← D-Bus ${label} ${this.address}: OK en ${ms()} ms`)
            return null
        } catch (e) {
            const msg = (e as Error).message ?? String(e)
            btLog(`← D-Bus ${label} ${this.address}: error en ${ms()} ms: ${msg}`)
            return msg
        }
    }

    pair() {
        return this._call("Pair", null)
    }

    connectAll() {
        return this._call("Connect", null)
    }

    connectAudio() {
        return this._call("ConnectProfile", new GLib.Variant("(s)", [A2DP_SINK_UUID]), "ConnectProfile A2DP")
    }

    disconnect_device(_arg?: any) {
        if (!this.proxy) return
        btLog(`→ D-Bus Disconnect ${this.name} (${this.address})`)
        this.proxy.call("Disconnect", null, Gio.DBusCallFlags.NONE, -1, null)
            .then(() => btLog(`← D-Bus Disconnect ${this.address}: OK`))
            .catch((e: unknown) => btLog(`← D-Bus Disconnect ${this.address}: error ${e}`))
    }
}

class Adapter extends GObject.Object {
    static {
        GObject.registerClass(
            {
                GTypeName: "ShiroBtAdapter",
                Properties: {
                    powered: GObject.ParamSpec.jsobject("powered", "", "", GObject.ParamFlags.READABLE),
                },
            },
            this,
        )
    }

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
            this._proxy.connect("g-properties-changed", (_p: any, changed: GLib.Variant) => {
                const desc = describeChanges(changed)
                if (desc) btLog(`adaptador cambió: ${desc}`)
                this._refresh()
            })
            this._refresh()
            btLog(`adaptador ${this.path}: Powered=${this._powered} Pairable=${readProp(this._proxy, "Pairable")} Discovering=${readProp(this._proxy, "Discovering")}`)
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

    get pairable(): boolean {
        return readProp(this._proxy, "Pairable") || false
    }

    // Borra el dispositivo de BlueZ, con su emparejamiento guardado
    async remove_device(devicePath: string): Promise<string | null> {
        if (!this._proxy) return "sin proxy de D-Bus"
        btLog(`→ D-Bus RemoveDevice ${devicePath}`)
        try {
            await this._proxy.call("RemoveDevice", new GLib.Variant("(o)", [devicePath]), Gio.DBusCallFlags.NONE, -1, null)
            btLog(`← D-Bus RemoveDevice ${devicePath}: OK`)
            return null
        } catch (e) {
            const msg = (e as Error).message ?? String(e)
            btLog(`← D-Bus RemoveDevice ${devicePath}: error ${msg}`)
            return msg
        }
    }

    set_pairable(value: boolean): Promise<string | null> {
        if (!this._proxy) return Promise.resolve("sin proxy de D-Bus")
        return setRemoteProperty(this._proxy, ADAPTER_IFACE, "Pairable", new GLib.Variant("b", value))
    }

    start_discovery() {
        this._callLogged("StartDiscovery")
    }

    stop_discovery() {
        this._callLogged("StopDiscovery")
    }

    private _callLogged(method: string) {
        if (!this._proxy) return
        btLog(`→ D-Bus ${method}`)
        this._proxy.call(method, null, Gio.DBusCallFlags.NONE, -1, null)
            .then(() => btLog(`← D-Bus ${method}: OK`))
            .catch((e: unknown) => btLog(`← D-Bus ${method}: error ${e}`))
    }

    private _refresh() {
        this._powered = readProp(this._proxy, "Powered") || false
        this.notify("powered")
    }
}

class Bluetooth extends GObject.Object {
    static {
        GObject.registerClass(
            {
                GTypeName: "ShiroBluetooth",
                Properties: {
                    devices: GObject.ParamSpec.jsobject("devices", "", "", GObject.ParamFlags.READABLE),
                    adapter: GObject.ParamSpec.jsobject("adapter", "", "", GObject.ParamFlags.READABLE),
                    "is-powered": GObject.ParamSpec.jsobject("is-powered", "", "", GObject.ParamFlags.READABLE),
                },
            },
            this,
        )
    }

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
            this._objectManager = await DBusProxy.new_for_bus(
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
            btLog(`BlueZ al conectar: ${this._adapter ? "hay adaptador" : "SIN adaptador"}, dispositivos: ${[...this._devices.keys()].map(p => p.split("/").pop()).join(", ") || "ninguno"}`)
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
                    btLog(`BlueZ InterfacesAdded ${path}: ${Object.keys(ifaces).join(", ")}`)
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
                    // bluez also drops secondary interfaces (e.g. Battery1 on disconnect) while the
                    // device object lives on; forgetting it then would hide its next reconnection
                    const [path, ifaces] = params.deep_unpack() as [string, string[]]
                    const dropped = ifaces.includes(DEVICE_IFACE) && this._devices.delete(path)
                    btLog(`BlueZ InterfacesRemoved ${path}: ${ifaces.join(", ")}${dropped ? " → se quita de la lista" : ""}`)
                    if (dropped) this.notify("devices")
                },
            )
        } catch (e) {
            logError(e as Error, "bluetooth: could not connect to bluez")
        }
    }
}

export default Bluetooth
