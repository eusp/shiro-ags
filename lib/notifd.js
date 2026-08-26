var _a;
// Lightweight stand-in for AstalNotifd: implements the standard
// org.freedesktop.Notifications D-Bus service directly instead of relying on
// astal's native binding (only available bundled with an old, unrelated
// astal-libs build that drifts out of sync with the system's astal version).
import GObject from "gi://GObject";
import GLib from "gi://GLib?version=2.0";
import Gio from "gi://Gio?version=2.0";
const IFACE_XML = `
<node>
  <interface name="org.freedesktop.Notifications">
    <method name="Notify">
      <arg type="s" name="app_name" direction="in"/>
      <arg type="u" name="replaces_id" direction="in"/>
      <arg type="s" name="app_icon" direction="in"/>
      <arg type="s" name="summary" direction="in"/>
      <arg type="s" name="body" direction="in"/>
      <arg type="as" name="actions" direction="in"/>
      <arg type="a{sv}" name="hints" direction="in"/>
      <arg type="i" name="expire_timeout" direction="in"/>
      <arg type="u" name="id" direction="out"/>
    </method>
    <method name="CloseNotification">
      <arg type="u" name="id" direction="in"/>
    </method>
    <method name="GetCapabilities">
      <arg type="as" name="caps" direction="out"/>
    </method>
    <method name="GetServerInformation">
      <arg type="s" name="name" direction="out"/>
      <arg type="s" name="vendor" direction="out"/>
      <arg type="s" name="version" direction="out"/>
      <arg type="s" name="spec_version" direction="out"/>
    </method>
    <signal name="NotificationClosed">
      <arg type="u" name="id"/>
      <arg type="u" name="reason"/>
    </signal>
    <signal name="ActionInvoked">
      <arg type="u" name="id"/>
      <arg type="s" name="action_key"/>
    </signal>
  </interface>
</node>`;
// Close reasons per the freedesktop notifications spec.
const REASON_EXPIRED = 1;
const REASON_DISMISSED = 2;
const REASON_CLOSE_CALL = 3;
const DEFAULT_TIMEOUT_MS = 6000;
export class Notification {
    constructor(daemon, id, data) {
        this._daemon = daemon;
        this.id = id;
        this.app_name = data.app_name;
        this.app_icon = data.app_icon;
        this.summary = data.summary;
        this.body = data.body;
    }
    dismiss() {
        this._daemon._close(this.id, REASON_DISMISSED);
    }
}
const Notifd = GObject.registerClass({
    GTypeName: "ShiroNotifd",
    Signals: {
        notified: { param_types: [GObject.TYPE_UINT] },
        resolved: { param_types: [GObject.TYPE_UINT] },
    },
}, (_a = class Notifd extends GObject.Object {
        static get_default() {
            if (!_a._instance)
                _a._instance = new _a();
            return _a._instance;
        }
        constructor() {
            super();
            this._notifications = new Map();
            this._nextId = 1;
            this._exported = null;
            // Deferred so owning org.freedesktop.Notifications doesn't block
            // the UI from becoming interactive at startup.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._own();
                return GLib.SOURCE_REMOVE;
            });
        }
        get_notifications() {
            return Array.from(this._notifications.values());
        }
        get_notification(id) {
            return this._notifications.get(id);
        }
        _close(id, reason) {
            if (!this._notifications.has(id))
                return;
            this._notifications.delete(id);
            if (this._exported) {
                try {
                    this._exported.emit_signal("NotificationClosed", new GLib.Variant("(uu)", [id, reason]));
                }
                catch (e) {
                    logError(e, "notifd: failed to emit NotificationClosed");
                }
            }
            this.emit("resolved", id);
        }
        // Shared by the D-Bus Notify() method and notify() below (AGS code
        // raising its own local notifications, e.g. a low-battery warning)
        // so both paths show up identically in the notification widgets.
        _create(id, appName, appIcon, summary, body, expireTimeoutMs) {
            this._notifications.set(id, new Notification(this, id, { app_name: appName, app_icon: appIcon, summary, body }));
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, expireTimeoutMs, () => {
                this._close(id, REASON_EXPIRED);
                return GLib.SOURCE_REMOVE;
            });
            this.emit("notified", id);
            return id;
        }
        _own() {
            const impl = {
                Notify: (appName, replacesId, appIcon, summary, body, _actions, hints, expireTimeout) => {
                    const id = replacesId > 0 ? replacesId : this._nextId++;
                    if (id >= this._nextId)
                        this._nextId = id + 1;
                    const icon = appIcon || hints?.["image-path"]?.deep_unpack?.() || "";
                    const timeoutMs = expireTimeout > 0 ? expireTimeout : DEFAULT_TIMEOUT_MS;
                    return this._create(id, appName, icon, summary, body, timeoutMs);
                },
                CloseNotification: (id) => {
                    this._close(id, REASON_CLOSE_CALL);
                },
                GetCapabilities: () => ["body", "actions", "icon-static"],
                GetServerInformation: () => ["shiro-notifd", "shiro-theme", "1.0", "1.2"],
            };
            Gio.bus_own_name(Gio.BusType.SESSION, "org.freedesktop.Notifications", Gio.BusNameOwnerFlags.NONE, (connection) => {
                this._exported = Gio.DBusExportedObject.wrapJSObject(IFACE_XML, impl);
                this._exported.export(connection, "/org/freedesktop/Notifications");
            }, () => { }, () => {
                logError(new Error("shiro-notifd: could not own org.freedesktop.Notifications — is another notification daemon running?"));
            });
        }
    },
    _a._instance = null,
    _a));
// For AGS code (not external D-Bus clients) to raise its own notifications —
// e.g. a low-battery warning — through the same daemon so they render in the
// same widgets as everything else.
export function notify(opts) {
    const daemon = Notifd.get_default();
    const id = daemon._nextId++;
    return daemon._create(id, opts.appName ?? "shiro-theme", opts.icon ?? "dialog-warning-symbolic", opts.summary, opts.body ?? "", opts.expireTimeoutMs ?? DEFAULT_TIMEOUT_MS);
}
export default Notifd;
