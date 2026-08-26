// Lightweight stand-in for AstalMpris: talks to MPRIS2 players over D-Bus
// directly instead of relying on astal's native binding (only available
// bundled with an old, unrelated astal-libs build that drifts out of sync
// with the system's actual astal version).
import GObject from "gi://GObject"
import GLib from "gi://GLib?version=2.0"
import Gio from "gi://Gio?version=2.0"

const PLAYER_OBJECT_PATH = "/org/mpris/MediaPlayer2"
const PLAYER_IFACE = "org.mpris.MediaPlayer2.Player"
const NAME_PREFIX = "org.mpris.MediaPlayer2."

export const PlaybackStatus = { PLAYING: "Playing", PAUSED: "Paused", STOPPED: "Stopped" }

function proxy(busName: string): any {
    return Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null, busName, PLAYER_OBJECT_PATH, PLAYER_IFACE, null)
}

const Player = GObject.registerClass(
    {
        GTypeName: "ShiroMprisPlayer",
        Properties: {
            title: GObject.ParamSpec.jsobject("title", "", "", GObject.ParamFlags.READABLE),
            "playback-status": GObject.ParamSpec.jsobject("playback-status", "", "", GObject.ParamFlags.READABLE),
        },
    },
    class Player extends GObject.Object {
        busName: string
        private _proxy: any
        private _title = ""
        private _playbackStatus: string = PlaybackStatus.STOPPED

        constructor(busName: string) {
            super()
            this.busName = busName
            this._proxy = proxy(busName)
            this._proxy.connect("g-properties-changed", () => this._refresh())
            this._refresh()
        }

        get title() {
            return this._title
        }

        get playbackStatus() {
            return this._playbackStatus
        }

        play_pause() {
            this._call("PlayPause")
        }

        next() {
            this._call("Next")
        }

        previous() {
            this._call("Previous")
        }

        private _call(method: string) {
            try {
                this._proxy.call(method, null, Gio.DBusCallFlags.NONE, -1, null, null)
            } catch (e) {
                logError(e as Error, `mpris: ${method} failed`)
            }
        }

        private _refresh() {
            const metadataVariant = this._proxy.get_cached_property("Metadata")
            const metadata = metadataVariant ? metadataVariant.recursiveUnpack() : {}
            const statusVariant = this._proxy.get_cached_property("PlaybackStatus")

            this._title = metadata?.["xesam:title"] || ""
            this._playbackStatus = statusVariant ? statusVariant.deep_unpack() : PlaybackStatus.STOPPED

            this.notify("title")
            this.notify("playback-status")
        }
    },
)

const Mpris = GObject.registerClass(
    {
        GTypeName: "ShiroMpris",
        Properties: {
            players: GObject.ParamSpec.jsobject("players", "", "", GObject.ParamFlags.READABLE),
        },
    },
    class Mpris extends GObject.Object {
        static _instance: InstanceType<typeof Mpris> | null = null
        static get_default() {
            if (!Mpris._instance) Mpris._instance = new Mpris()
            return Mpris._instance
        }

        private _players = new Map<string, InstanceType<typeof Player>>()

        constructor() {
            super()
            // Deferred so the session-bus ListNames sync call doesn't block the
            // UI from becoming interactive at startup.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._connect()
                return GLib.SOURCE_REMOVE
            })
        }

        get players(): InstanceType<typeof Player>[] {
            return Array.from(this._players.values())
        }

        private _addPlayer(name: string) {
            if (this._players.has(name)) return
            this._players.set(name, new Player(name))
        }

        private _connect() {
            try {
                const dbusProxy = Gio.DBusProxy.new_for_bus_sync(
                    Gio.BusType.SESSION,
                    Gio.DBusProxyFlags.NONE,
                    null,
                    "org.freedesktop.DBus",
                    "/org/freedesktop/DBus",
                    "org.freedesktop.DBus",
                    null,
                )

                const result = dbusProxy.call_sync("ListNames", null, Gio.DBusCallFlags.NONE, -1, null)
                const [names] = (result as any).deep_unpack() as [string[]]
                for (const name of names) {
                    if (name.startsWith(NAME_PREFIX)) this._addPlayer(name)
                }
                this.notify("players")

                dbusProxy.connect("g-signal", (_p: any, _sender: string, signal: string, params: any) => {
                    if (signal !== "NameOwnerChanged") return
                    const [name, oldOwner, newOwner] = params.deep_unpack() as [string, string, string]
                    if (!name.startsWith(NAME_PREFIX)) return
                    if (newOwner && !oldOwner) {
                        this._addPlayer(name)
                        this.notify("players")
                    } else if (!newOwner && oldOwner) {
                        if (this._players.delete(name)) this.notify("players")
                    }
                })
            } catch (e) {
                logError(e as Error, "mpris: could not connect to session bus")
            }
        }
    },
)
;(Mpris as any).PlaybackStatus = PlaybackStatus

export default Mpris
