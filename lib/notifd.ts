// Lightweight stand-in for AstalNotifd: implements the standard
// org.freedesktop.Notifications D-Bus service directly instead of relying on
// astal's native binding (only available bundled with an old, unrelated
// astal-libs build that drifts out of sync with the system's astal version).
import GObject from "gi://GObject"
import GLib from "gi://GLib?version=2.0"
import Gio from "gi://Gio?version=2.0"

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
</node>`

// Close reasons per the freedesktop notifications spec.
const REASON_EXPIRED = 1
const REASON_DISMISSED = 2
const REASON_CLOSE_CALL = 3

const DEFAULT_TIMEOUT_MS = 6000

export class Notification {
    id: number
    app_name: string
    app_icon: string
    summary: string
    body: string
    private _daemon: InstanceType<typeof Notifd>

    constructor(daemon: InstanceType<typeof Notifd>, id: number, data: {
        app_name: string
        app_icon: string
        summary: string
        body: string
    }) {
        this._daemon = daemon
        this.id = id
        this.app_name = data.app_name
        this.app_icon = data.app_icon
        this.summary = data.summary
        this.body = data.body
    }

    dismiss() {
        this._daemon._close(this.id, REASON_DISMISSED)
    }
}

const Notifd = GObject.registerClass(
    {
        GTypeName: "ShiroNotifd",
        Signals: {
            notified: { param_types: [GObject.TYPE_UINT] },
            resolved: { param_types: [GObject.TYPE_UINT] },
        },
    },
    class Notifd extends GObject.Object {
        static _instance: InstanceType<typeof Notifd> | null = null
        static get_default() {
            if (!Notifd._instance) Notifd._instance = new Notifd()
            return Notifd._instance
        }

        private _notifications = new Map<number, Notification>()
        private _nextId = 1
        private _exported: any = null

        constructor() {
            super()
            this._own()
        }

        get_notifications(): Notification[] {
            return Array.from(this._notifications.values())
        }

        get_notification(id: number): Notification | undefined {
            return this._notifications.get(id)
        }

        _close(id: number, reason: number) {
            if (!this._notifications.has(id)) return
            this._notifications.delete(id)

            if (this._exported) {
                try {
                    this._exported.emit_signal(
                        "NotificationClosed",
                        new GLib.Variant("(uu)", [id, reason]),
                    )
                } catch (e) {
                    logError(e as Error, "notifd: failed to emit NotificationClosed")
                }
            }

            this.emit("resolved", id)
        }

        // Shared by the D-Bus Notify() method and notify() below (AGS code
        // raising its own local notifications, e.g. a low-battery warning)
        // so both paths show up identically in the notification widgets.
        _create(
            id: number,
            appName: string,
            appIcon: string,
            summary: string,
            body: string,
            expireTimeoutMs: number,
        ): number {
            this._notifications.set(
                id,
                new Notification(this, id, { app_name: appName, app_icon: appIcon, summary, body }),
            )

            GLib.timeout_add(GLib.PRIORITY_DEFAULT, expireTimeoutMs, () => {
                this._close(id, REASON_EXPIRED)
                return GLib.SOURCE_REMOVE
            })

            this.emit("notified", id)
            return id
        }

        private _own() {
            const impl = {
                Notify: (
                    appName: string,
                    replacesId: number,
                    appIcon: string,
                    summary: string,
                    body: string,
                    _actions: string[],
                    hints: Record<string, GLib.Variant>,
                    expireTimeout: number,
                ) => {
                    const id = replacesId > 0 ? replacesId : this._nextId++
                    if (id >= this._nextId) this._nextId = id + 1

                    const icon = appIcon || hints?.["image-path"]?.deep_unpack?.() || ""
                    const timeoutMs = expireTimeout > 0 ? expireTimeout : DEFAULT_TIMEOUT_MS

                    return this._create(id, appName, icon, summary, body, timeoutMs)
                },
                CloseNotification: (id: number) => {
                    this._close(id, REASON_CLOSE_CALL)
                },
                GetCapabilities: () => ["body", "actions", "icon-static"],
                GetServerInformation: () => ["shiro-notifd", "shiro-theme", "1.0", "1.2"],
            }

            Gio.bus_own_name(
                Gio.BusType.SESSION,
                "org.freedesktop.Notifications",
                Gio.BusNameOwnerFlags.NONE,
                (connection: any) => {
                    this._exported = Gio.DBusExportedObject.wrapJSObject(IFACE_XML, impl)
                    this._exported.export(connection, "/org/freedesktop/Notifications")
                },
                () => {},
                () => {
                    logError(
                        new Error("shiro-notifd: could not own org.freedesktop.Notifications — is another notification daemon running?"),
                    )
                },
            )
        }
    },
)

// For AGS code (not external D-Bus clients) to raise its own notifications —
// e.g. a low-battery warning — through the same daemon so they render in the
// same widgets as everything else.
export function notify(opts: {
    appName?: string
    summary: string
    body?: string
    icon?: string
    expireTimeoutMs?: number
}): number {
    const daemon = Notifd.get_default()
    const id = (daemon as any)._nextId++
    return (daemon as any)._create(
        id,
        opts.appName ?? "shiro-theme",
        opts.icon ?? "dialog-warning-symbolic",
        opts.summary,
        opts.body ?? "",
        opts.expireTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    )
}

export default Notifd
