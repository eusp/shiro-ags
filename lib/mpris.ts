// Lightweight stand-in for AstalMpris: talks to MPRIS2 players over D-Bus
// directly instead of relying on astal's native binding (only available
// bundled with an old, unrelated astal-libs build that drifts out of sync
// with the system's actual astal version).
import GObject from "gi://GObject"
import GLib from "gi://GLib?version=2.0"
import Gio from "gi://Gio?version=2.0"

const PLAYER_OBJECT_PATH = "/org/mpris/MediaPlayer2"
const PLAYER_IFACE = "org.mpris.MediaPlayer2.Player"
const POLL_MS = 3000
const NAME_PREFIX = "org.mpris.MediaPlayer2."

export const PlaybackStatus = { PLAYING: "Playing", PAUSED: "Paused", STOPPED: "Stopped" }

// GET_INVALIDATED_PROPERTIES: Spotify a veces avisa que Metadata cambió sin
// mandar el valor ("invalidated"), y sin este flag GDBusProxy la borra de la
// caché y no la vuelve a pedir: el título quedaba vacío.
function proxy(busName: string): any {
    return Gio.DBusProxy.new_for_bus_sync(
        Gio.BusType.SESSION,
        Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES,
        null,
        busName,
        PLAYER_OBJECT_PATH,
        PLAYER_IFACE,
        null,
    )
}

class Player extends GObject.Object {
    static {
        GObject.registerClass(
            {
                GTypeName: "ShiroMprisPlayer",
                Properties: {
                    title: GObject.ParamSpec.jsobject("title", "", "", GObject.ParamFlags.READABLE),
                    artist: GObject.ParamSpec.jsobject("artist", "", "", GObject.ParamFlags.READABLE),
                    "art-url": GObject.ParamSpec.jsobject("art-url", "", "", GObject.ParamFlags.READABLE),
                    "playback-status": GObject.ParamSpec.jsobject("playback-status", "", "", GObject.ParamFlags.READABLE),
                },
            },
            this,
        )
    }

    busName: string
    private _proxy: any
    private _title = ""
    private _artist = ""
    private _artUrl = ""
    private _length = 0 // µs, 0 si el reproductor no lo dice
    private _pollId = 0
    private _playbackStatus: string = PlaybackStatus.STOPPED

    constructor(busName: string) {
        super()
        this.busName = busName
        this._proxy = proxy(busName)
        this._proxy.connect("g-properties-changed", () => this._refresh())
        // Si el reproductor reconecta (cambia el dueño del nombre en D-Bus),
        // GDBusProxy recarga sus propiedades pero no avisa por
        // g-properties-changed.
        this._proxy.connect("notify::g-name-owner", () => this._refresh())
        this._refresh()
        // Red de seguridad: si igual se pierde un aviso (Spotify recién
        // abierto quedaba sin título), se corrige leyendo todo cada POLL_MS.
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
            this._poll()
            return GLib.SOURCE_CONTINUE
        })
    }

    // Lo llama Mpris cuando el reproductor se cierra.
    destroy() {
        if (this._pollId) GLib.source_remove(this._pollId)
        this._pollId = 0
    }

    private _poll() {
        Gio.DBus.session.call(
            this.busName,
            PLAYER_OBJECT_PATH,
            "org.freedesktop.DBus.Properties",
            "GetAll",
            new GLib.Variant("(s)", [PLAYER_IFACE]),
            null,
            Gio.DBusCallFlags.NONE,
            1000,
            null,
            (_c: any, res: any) => {
                try {
                    const [props] = Gio.DBus.session.call_finish(res).recursiveUnpack() as [Record<string, any>]
                    this._apply(props.Metadata ?? {}, props.PlaybackStatus)
                } catch {
                    // El reproductor se cerró o no respondió: lo saca Mpris.
                }
            },
        )
    }

    get title() {
        return this._title
    }

    get artist() {
        return this._artist
    }

    get artUrl() {
        return this._artUrl
    }

    get length() {
        return this._length
    }

    get playbackStatus() {
        return this._playbackStatus
    }

    // Position no llega en PropertiesChanged (cambia todo el tiempo): hay
    // que pedirla. En µs; 0 si el reproductor no la da.
    position(): Promise<number> {
        return new Promise((resolve) => {
            Gio.DBus.session.call(
                this.busName,
                PLAYER_OBJECT_PATH,
                "org.freedesktop.DBus.Properties",
                "Get",
                new GLib.Variant("(ss)", [PLAYER_IFACE, "Position"]),
                null,
                Gio.DBusCallFlags.NONE,
                1000,
                null,
                (_c: any, res: any) => {
                    try {
                        const [variant] = Gio.DBus.session.call_finish(res).deep_unpack() as [GLib.Variant]
                        const value = variant.deep_unpack()
                        resolve(Number(value) || 0)
                    } catch {
                        resolve(0)
                    }
                },
            )
        })
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
        const statusVariant = this._proxy.get_cached_property("PlaybackStatus")
        this._apply(metadataVariant ? metadataVariant.recursiveUnpack() : {}, statusVariant?.deep_unpack())
    }

    // Avisa solo lo que cambió (el sondeo corre cada pocos segundos).
    private _apply(metadata: Record<string, any>, status: string | undefined) {
        const artist = metadata?.["xesam:artist"]
        const next = {
            title: metadata?.["xesam:title"] || "",
            artist: Array.isArray(artist) ? artist.join(", ") : artist || "",
            artUrl: metadata?.["mpris:artUrl"] || "",
            length: Number(metadata?.["mpris:length"]) || 0,
            status: status || PlaybackStatus.STOPPED,
        }
        const changed = (key: string, prev: unknown, value: unknown) => prev !== value && key
        const notify = [
            changed("title", this._title, next.title),
            changed("artist", this._artist, next.artist),
            changed("art-url", this._artUrl, next.artUrl),
            changed("playback-status", this._playbackStatus, next.status),
        ].filter(Boolean) as string[]

        this._title = next.title
        this._artist = next.artist
        this._artUrl = next.artUrl
        this._length = next.length
        this._playbackStatus = next.status
        for (const prop of notify) this.notify(prop)
    }
}

class Mpris extends GObject.Object {
    static {
        GObject.registerClass(
            {
                GTypeName: "ShiroMpris",
                Properties: {
                    players: GObject.ParamSpec.jsobject("players", "", "", GObject.ParamFlags.READABLE),
                },
            },
            this,
        )
    }

    static PlaybackStatus = PlaybackStatus
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
                    const player = this._players.get(name)
                    if (player) {
                        player.destroy()
                        this._players.delete(name)
                        this.notify("players")
                    }
                }
            })
        } catch (e) {
            logError(e as Error, "mpris: could not connect to session bus")
        }
    }
}

export default Mpris
