var _a;
// Lightweight stand-in for AstalBattery: talks to UPower over D-Bus directly
// instead of relying on astal's native binding (only available bundled with
// an old, unrelated astal-libs build that drifts out of sync with the
// system's actual astal version). Also emits its own "low-battery" signal —
// widget/Shared/BatteryAlertOverlay.tsx reacts to it — since nothing else in
// this setup warned about it at all.
import GObject from "gi://GObject";
import GLib from "gi://GLib?version=2.0";
import Gio from "gi://Gio?version=2.0";
const BUS_NAME = "org.freedesktop.UPower";
const OBJECT_PATH = "/org/freedesktop/UPower/devices/DisplayDevice";
const IFACE = "org.freedesktop.UPower.Device";
// UPower's own State enum (org.freedesktop.UPower.Device).
export const BatteryState = {
    UNKNOWN: 0,
    CHARGING: 1,
    DISCHARGING: 2,
    EMPTY: 3,
    FULLY_CHARGED: 4,
    PENDING_CHARGE: 5,
    PENDING_DISCHARGE: 6,
};
// UPower's own WarningLevel enum — it already computes "low"/"critical"
// using the same policy GNOME's shell uses, so there's no need to reinvent
// percentage thresholds here.
export const WarningLevel = {
    UNKNOWN: 0,
    NONE: 1,
    DISCHARGING: 2,
    LOW: 3,
    CRITICAL: 4,
    ACTION: 5,
};
// While discharging and still low/critical, remind again every 5 minutes
// instead of only once — easy to miss a single notification.
const ALERT_REPEAT_MS = 5 * 60 * 1000;
const Battery = GObject.registerClass({
    GTypeName: "ShiroBattery",
    Properties: {
        percentage: GObject.ParamSpec.jsobject("percentage", "percentage", "percentage", GObject.ParamFlags.READABLE),
        "icon-name": GObject.ParamSpec.jsobject("icon-name", "icon-name", "icon-name", GObject.ParamFlags.READABLE),
        "is-present": GObject.ParamSpec.jsobject("is-present", "is-present", "is-present", GObject.ParamFlags.READABLE),
        state: GObject.ParamSpec.jsobject("state", "state", "state", GObject.ParamFlags.READABLE),
        "warning-level": GObject.ParamSpec.jsobject("warning-level", "warning-level", "warning-level", GObject.ParamFlags.READABLE),
    },
    Signals: {
        // (percentage: uint, critical: boolean) — a screen-covering alert
        // reacts to this directly; relying on sound alone doesn't help
        // when the volume is muted or at 0.
        "low-battery": { param_types: [GObject.TYPE_UINT, GObject.TYPE_BOOLEAN] },
    },
}, (_a = class Battery extends GObject.Object {
        static get_default() {
            if (!_a._instance)
                _a._instance = new _a();
            return _a._instance;
        }
        constructor() {
            super();
            this._percentage = 1;
            this._iconName = "battery-missing-symbolic";
            this._isPresent = false;
            this._state = BatteryState.UNKNOWN;
            this._warningLevel = WarningLevel.UNKNOWN;
            this._lastAlertLevel = WarningLevel.NONE;
            this._lastAlertTime = 0;
            this._proxy = null;
            // Deferred so the UPower D-Bus setup doesn't block the UI from
            // becoming interactive at startup.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._connect();
                return GLib.SOURCE_REMOVE;
            });
        }
        get percentage() {
            return this._percentage;
        }
        get iconName() {
            return this._iconName;
        }
        get isPresent() {
            return this._isPresent;
        }
        get state() {
            return this._state;
        }
        get warningLevel() {
            return this._warningLevel;
        }
        _connect() {
            try {
                this._proxy = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null, BUS_NAME, OBJECT_PATH, IFACE, null);
                this._proxy.connect("g-properties-changed", () => this._refresh());
                this._refresh();
            }
            catch (e) {
                logError(e, "battery: could not connect to UPower");
            }
        }
        _readProp(name) {
            const v = this._proxy?.get_cached_property(name);
            return v ? v.deep_unpack() : null;
        }
        _refresh() {
            const pct = this._readProp("Percentage");
            this._percentage = pct != null ? pct / 100 : 1;
            this._iconName = this._readProp("IconName") || "battery-missing-symbolic";
            this._isPresent = this._readProp("IsPresent") ?? false;
            this._state = this._readProp("State") ?? BatteryState.UNKNOWN;
            this._warningLevel = this._readProp("WarningLevel") ?? WarningLevel.UNKNOWN;
            this.notify("percentage");
            this.notify("icon-name");
            this.notify("is-present");
            this.notify("state");
            this.notify("warning-level");
            this._maybeAlert();
        }
        _maybeAlert() {
            const discharging = this._state === BatteryState.DISCHARGING;
            const isLowOrWorse = this._warningLevel >= WarningLevel.LOW;
            if (!discharging || !this._isPresent || !isLowOrWorse) {
                this._lastAlertLevel = WarningLevel.NONE;
                return;
            }
            const now = GLib.get_monotonic_time() / 1000;
            const escalated = this._warningLevel > this._lastAlertLevel;
            const dueForRepeat = now - this._lastAlertTime > ALERT_REPEAT_MS;
            if (!escalated && !dueForRepeat)
                return;
            this._lastAlertLevel = this._warningLevel;
            this._lastAlertTime = now;
            const pct = Math.round(this._percentage * 100);
            const critical = this._warningLevel >= WarningLevel.CRITICAL;
            this.emit("low-battery", pct, critical);
        }
    },
    _a._instance = null,
    _a));
export default Battery;
