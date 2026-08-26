var _a;
// Lightweight stand-in for AstalNetwork: talks to NetworkManager over D-Bus
// directly instead of relying on astal's native binding (only available
// bundled with an old, unrelated astal-libs build that drifts out of sync
// with the system's actual astal version).
import GObject from "gi://GObject";
import GLib from "gi://GLib?version=2.0";
import Gio from "gi://Gio?version=2.0";
const NM_BUS = "org.freedesktop.NetworkManager";
const NM_PATH = "/org/freedesktop/NetworkManager";
const NM_IFACE = "org.freedesktop.NetworkManager";
const DEVICE_IFACE = "org.freedesktop.NetworkManager.Device";
const WIRELESS_IFACE = "org.freedesktop.NetworkManager.Device.Wireless";
const AP_IFACE = "org.freedesktop.NetworkManager.AccessPoint";
// NetworkManager's own enums (NMConnectivityState / NMDeviceType / NMDeviceState).
export const Connectivity = { UNKNOWN: 0, NONE: 1, PORTAL: 2, LIMITED: 3, FULL: 4 };
const DEVICE_TYPE_ETHERNET = 1;
const DEVICE_TYPE_WIFI = 2;
const DEVICE_STATE_ACTIVATED = 100;
function proxy(busName, path, iface) {
    return Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null, busName, path, iface, null);
}
function setProp(busName, path, iface, propName, value) {
    const p = proxy(busName, path, "org.freedesktop.DBus.Properties");
    p.call_sync("Set", new GLib.Variant("(ssv)", [iface, propName, value]), Gio.DBusCallFlags.NONE, -1, null);
}
function readProp(p, name) {
    const v = p?.get_cached_property(name);
    return v ? v.deep_unpack() : null;
}
function decodeSsid(bytes) {
    if (!bytes || bytes.length === 0)
        return "";
    try {
        return new TextDecoder().decode(new Uint8Array(bytes));
    }
    catch {
        return "";
    }
}
function wifiIconForStrength(strength) {
    const level = strength >= 80 ? "excellent" : strength >= 55 ? "good" : strength >= 30 ? "ok" : strength > 0 ? "weak" : "none";
    return `network-wireless-signal-${level}-symbolic`;
}
export class AccessPoint {
    constructor(path) {
        this.path = path;
        const p = proxy(NM_BUS, path, AP_IFACE);
        this.ssid = decodeSsid(readProp(p, "Ssid"));
        this.bssid = readProp(p, "HwAddress") || "";
        this.strength = readProp(p, "Strength") || 0;
        this.security = (readProp(p, "WpaFlags") || 0) + (readProp(p, "RsnFlags") || 0);
        this.iconName = wifiIconForStrength(this.strength);
    }
}
const WifiDevice = GObject.registerClass({
    GTypeName: "ShiroNetworkWifi",
    Properties: {
        "access-points": GObject.ParamSpec.jsobject("access-points", "", "", GObject.ParamFlags.READABLE),
        ssid: GObject.ParamSpec.jsobject("ssid", "", "", GObject.ParamFlags.READABLE),
        "icon-name": GObject.ParamSpec.jsobject("icon-name", "", "", GObject.ParamFlags.READABLE),
    },
}, class WifiDevice extends GObject.Object {
    constructor(devicePath) {
        super();
        this._accessPoints = [];
        this._ssid = "";
        this._iconName = "network-wireless-offline-symbolic";
        this._proxy = proxy(NM_BUS, devicePath, WIRELESS_IFACE);
        this._proxy.connect("g-properties-changed", () => this._refresh());
        this._refresh();
    }
    get access_points() {
        return this._accessPoints;
    }
    get ssid() {
        return this._ssid;
    }
    get iconName() {
        return this._iconName;
    }
    scan() {
        try {
            this._proxy.call("RequestScan", new GLib.Variant("(a{sv})", [{}]), Gio.DBusCallFlags.NONE, -1, null, null);
        }
        catch (e) {
            logError(e, "network: scan failed");
        }
    }
    _refresh() {
        const apPaths = readProp(this._proxy, "AccessPoints") || [];
        this._accessPoints = apPaths
            .map((p) => {
            try {
                return new AccessPoint(p);
            }
            catch (e) {
                return null;
            }
        })
            .filter((a) => a !== null);
        const activePath = readProp(this._proxy, "ActiveAccessPoint");
        const active = activePath && activePath !== "/" ? this._accessPoints.find((a) => a.path === activePath) : null;
        this._ssid = active?.ssid || "";
        this._iconName = active?.iconName || "network-wireless-offline-symbolic";
        this.notify("access-points");
        this.notify("ssid");
        this.notify("icon-name");
    }
});
const Network = GObject.registerClass({
    GTypeName: "ShiroNetwork",
    Properties: {
        primary: GObject.ParamSpec.jsobject("primary", "", "", GObject.ParamFlags.READABLE),
        wifi: GObject.ParamSpec.jsobject("wifi", "", "", GObject.ParamFlags.READABLE),
        wired: GObject.ParamSpec.jsobject("wired", "", "", GObject.ParamFlags.READABLE),
        connectivity: GObject.ParamSpec.jsobject("connectivity", "", "", GObject.ParamFlags.READABLE),
        "wifi-enabled": GObject.ParamSpec.jsobject("wifi-enabled", "", "", GObject.ParamFlags.READABLE),
    },
}, (_a = class Network extends GObject.Object {
        static get_default() {
            if (!_a._instance)
                _a._instance = new _a();
            return _a._instance;
        }
        constructor() {
            super();
            this._wifiDevice = null;
            this._wiredActive = false;
            this._connectivity = Connectivity.UNKNOWN;
            this._primaryType = null;
            this._wifiEnabled = true;
            this._connect();
        }
        get wifi() {
            return this._wifiDevice && this._wifiDevice.ssid ? this._wifiDevice : null;
        }
        // Unlike `wifi` (only set once actively connected to an SSID), this is
        // the wifi device as soon as it exists, so scan results / the AP list
        // are available while the radio is on but not yet connected to anything.
        get wifiDevice() {
            return this._wifiDevice;
        }
        get wired() {
            return this._wiredActive;
        }
        get connectivity() {
            return this._connectivity;
        }
        get wifiEnabled() {
            return this._wifiEnabled;
        }
        setWifiEnabled(enabled) {
            try {
                setProp(NM_BUS, NM_PATH, NM_IFACE, "WirelessEnabled", new GLib.Variant("b", enabled));
            }
            catch (e) {
                logError(e, "network: could not toggle wifi radio");
            }
        }
        get primary() {
            if (!this._primaryType)
                return null;
            return { type: this._primaryType, wifi: this._primaryType === "WIFI" ? this._wifiDevice : null };
        }
        _connect() {
            try {
                this._nmProxy = proxy(NM_BUS, NM_PATH, NM_IFACE);
                this._nmProxy.connect("g-properties-changed", () => this._refresh());
                this._discoverDevices();
                this._refresh();
            }
            catch (e) {
                logError(e, "network: could not connect to NetworkManager");
            }
        }
        _discoverDevices() {
            const devicePaths = readProp(this._nmProxy, "Devices") || [];
            for (const path of devicePaths) {
                try {
                    const devProxy = proxy(NM_BUS, path, DEVICE_IFACE);
                    const type = readProp(devProxy, "DeviceType");
                    if (type === DEVICE_TYPE_WIFI && !this._wifiDevice) {
                        this._wifiDevice = new WifiDevice(path);
                        this._wifiDevice.connect("notify::ssid", () => {
                            this.notify("wifi");
                            this.notify("primary");
                        });
                        this._wifiDevice.connect("notify::access-points", () => this.notify("wifi"));
                    }
                    if (type === DEVICE_TYPE_ETHERNET) {
                        const refreshWired = () => {
                            const active = readProp(devProxy, "State") === DEVICE_STATE_ACTIVATED;
                            if (active !== this._wiredActive) {
                                this._wiredActive = active;
                                this.notify("wired");
                                // Ethernet just came up: prefer the wired link and free the wifi radio.
                                if (active && this._wifiEnabled)
                                    this.setWifiEnabled(false);
                            }
                        };
                        devProxy.connect("g-properties-changed", refreshWired);
                        refreshWired();
                    }
                }
                catch (e) {
                    logError(e, `network: could not probe device ${path}`);
                }
            }
        }
        _refresh() {
            const type = readProp(this._nmProxy, "PrimaryConnectionType") || "";
            const known = { "802-11-wireless": "WIFI", "802-3-ethernet": "WIRED" };
            this._primaryType = type ? known[type] || type.toUpperCase() : null;
            this._connectivity = readProp(this._nmProxy, "Connectivity") ?? Connectivity.UNKNOWN;
            const wifiEnabled = readProp(this._nmProxy, "WirelessEnabled");
            if (wifiEnabled !== null && wifiEnabled !== this._wifiEnabled) {
                this._wifiEnabled = wifiEnabled;
                this.notify("wifi-enabled");
            }
            this.notify("primary");
            this.notify("connectivity");
        }
    },
    _a._instance = null,
    _a));
Network.Connectivity = Connectivity;
export default Network;
