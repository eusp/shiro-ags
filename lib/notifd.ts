// Lightweight stand-in for AstalNotifd: implements the standard
// org.freedesktop.Notifications D-Bus service directly instead of relying on
// astal's native binding (only available bundled with an old, unrelated
// astal-libs build that drifts out of sync with the system's astal version).
import GObject from "gi://GObject"
import GLib from "gi://GLib?version=2.0"
import Gio from "gi://Gio?version=2.0"
import { stateFile } from "./localState"

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

// Survives AGS restarts; kept in state/ with the rest of the local shell state.
const HISTORY_FILE = stateFile("notifications.json")

interface SavedNotification {
    id: number
    app_name: string
    app_icon: string
    summary: string
    body: string
}

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

class Notifd extends GObject.Object {
    static {
        GObject.registerClass(
            {
                GTypeName: "ShiroNotifd",
                Signals: {
                    notified: { param_types: [GObject.TYPE_UINT] },
                    resolved: { param_types: [GObject.TYPE_UINT] },
                },
            },
            this,
        )
    }

    static readonly MAX_HISTORY = 100

    static _instance: InstanceType<typeof Notifd> | null = null
    static get_default() {
        if (!Notifd._instance) Notifd._instance = new Notifd()
        return Notifd._instance
    }

    // Insertion order = oldest first; get_notifications() hands them out newest first.
    private _notifications = new Map<number, Notification>()
    private _expiryTimers = new Map<number, number>()
    // Senders already told their notification is gone. An expired notification
    // stays in the history, and must not be reported closed a second time when
    // the user dismisses it later.
    private _signaled = new Set<number>()
    private _nextId = 1
    private _exported: any = null

    constructor() {
        super()
        this._load()
        // Deferred so owning org.freedesktop.Notifications doesn't block
        // the UI from becoming interactive at startup.
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._own()
            return GLib.SOURCE_REMOVE
        })
    }

    get_notifications(): Notification[] {
        return Array.from(this._notifications.values()).reverse()
    }

    get_notification(id: number): Notification | undefined {
        return this._notifications.get(id)
    }

    private _signalClosed(id: number, reason: number) {
        const timer = this._expiryTimers.get(id)
        if (timer !== undefined) {
            GLib.source_remove(timer)
            this._expiryTimers.delete(id)
        }
        if (this._signaled.has(id)) return
        this._signaled.add(id)

        if (!this._exported) return
        try {
            this._exported.emit_signal(
                "NotificationClosed",
                new GLib.Variant("(uu)", [id, reason]),
            )
        } catch (e) {
            logError(e as Error, "notifd: failed to emit NotificationClosed")
        }
    }

    private _forget(id: number) {
        this._notifications.delete(id)
        this._signaled.delete(id)
    }

    // Removes a notification from the history. Only the user (dismiss) or the
    // sending app (CloseNotification) do this; expiring just ends the popup.
    _close(id: number, reason: number) {
        if (!this._notifications.has(id)) return
        this._signalClosed(id, reason)
        this._forget(id)
        this._save()
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
        // A replacement (same id) restarts as a fresh notification at the top;
        // its old timer would otherwise report the new one expired early.
        const oldTimer = this._expiryTimers.get(id)
        if (oldTimer !== undefined) {
            GLib.source_remove(oldTimer)
            this._expiryTimers.delete(id)
        }
        this._forget(id)
        this._notifications.set(
            id,
            new Notification(this, id, { app_name: appName, app_icon: appIcon, summary, body }),
        )

        this._expiryTimers.set(
            id,
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, expireTimeoutMs, () => {
                this._expiryTimers.delete(id)
                this._signalClosed(id, REASON_EXPIRED)
                return GLib.SOURCE_REMOVE
            }),
        )

        while (this._notifications.size > Notifd.MAX_HISTORY) {
            const oldest = this._notifications.keys().next().value as number
            this._signalClosed(oldest, REASON_EXPIRED)
            this._forget(oldest)
        }

        this._save()
        this.emit("notified", id)
        return id
    }

    private _load() {
        if (!GLib.file_test(HISTORY_FILE, GLib.FileTest.EXISTS)) return
        try {
            const [, contents] = Gio.File.new_for_path(HISTORY_FILE).load_contents(null)
            const saved = JSON.parse(new TextDecoder().decode(contents)) as SavedNotification[]

            for (const s of saved.slice(-Notifd.MAX_HISTORY)) {
                // image-path icons often point at temp files that are gone after a reboot
                const iconPath = s.app_icon?.startsWith("file://") ? s.app_icon.slice(7) : s.app_icon
                const icon = iconPath?.startsWith("/") && !GLib.file_test(iconPath, GLib.FileTest.EXISTS)
                    ? ""
                    : (s.app_icon ?? "")

                this._notifications.set(
                    s.id,
                    new Notification(this, s.id, {
                        app_name: s.app_name ?? "",
                        app_icon: icon,
                        summary: s.summary ?? "",
                        body: s.body ?? "",
                    }),
                )
                // Their senders belong to a previous session: nobody waits for a close signal.
                this._signaled.add(s.id)
                this._nextId = Math.max(this._nextId, s.id + 1)
            }
        } catch (e) {
            logError(e as Error, "notifd: could not load notification history")
        }
    }

    private _save() {
        const data: SavedNotification[] = Array.from(this._notifications.values()).map(n => ({
            id: n.id,
            app_name: n.app_name,
            app_icon: n.app_icon,
            summary: n.summary,
            body: n.body,
        }))
        try {
            Gio.File.new_for_path(HISTORY_FILE).replace_contents(
                new TextEncoder().encode(JSON.stringify(data, null, 2)),
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null,
            )
        } catch (e) {
            logError(e as Error, "notifd: could not save notification history")
        }
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

                const icon = appIcon || hints?.["image-path"]?.deep_unpack?.<string>() || ""
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
}

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
