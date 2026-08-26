var _a;
// Lightweight stand-in for AstalMpris: talks to MPRIS2 players over D-Bus
// directly instead of relying on astal's native binding (only available
// bundled with an old, unrelated astal-libs build that drifts out of sync
// with the system's actual astal version).
import GObject from "gi://GObject";
import GLib from "gi://GLib?version=2.0";
import Gio from "gi://Gio?version=2.0";
const PLAYER_OBJECT_PATH = "/org/mpris/MediaPlayer2";
const PLAYER_IFACE = "org.mpris.MediaPlayer2.Player";
const NAME_PREFIX = "org.mpris.MediaPlayer2.";
export const PlaybackStatus = { PLAYING: "Playing", PAUSED: "Paused", STOPPED: "Stopped" };
function proxy(busName) {
    return Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null, busName, PLAYER_OBJECT_PATH, PLAYER_IFACE, null);
}
const Player = GObject.registerClass({
    GTypeName: "ShiroMprisPlayer",
    Properties: {
        title: GObject.ParamSpec.jsobject("title", "", "", GObject.ParamFlags.READABLE),
        "playback-status": GObject.ParamSpec.jsobject("playback-status", "", "", GObject.ParamFlags.READABLE),
    },
}, class Player extends GObject.Object {
    constructor(busName) {
        super();
        this._title = "";
        this._playbackStatus = PlaybackStatus.STOPPED;
        this.busName = busName;
        this._proxy = proxy(busName);
        this._proxy.connect("g-properties-changed", () => this._refresh());
        this._refresh();
    }
    get title() {
        return this._title;
    }
    get playbackStatus() {
        return this._playbackStatus;
    }
    play_pause() {
        this._call("PlayPause");
    }
    next() {
        this._call("Next");
    }
    previous() {
        this._call("Previous");
    }
    _call(method) {
        try {
            this._proxy.call(method, null, Gio.DBusCallFlags.NONE, -1, null, null);
        }
        catch (e) {
            logError(e, `mpris: ${method} failed`);
        }
    }
    _refresh() {
        const metadataVariant = this._proxy.get_cached_property("Metadata");
        const metadata = metadataVariant ? metadataVariant.recursiveUnpack() : {};
        const statusVariant = this._proxy.get_cached_property("PlaybackStatus");
        this._title = metadata?.["xesam:title"] || "";
        this._playbackStatus = statusVariant ? statusVariant.deep_unpack() : PlaybackStatus.STOPPED;
        this.notify("title");
        this.notify("playback-status");
    }
});
const Mpris = GObject.registerClass({
    GTypeName: "ShiroMpris",
    Properties: {
        players: GObject.ParamSpec.jsobject("players", "", "", GObject.ParamFlags.READABLE),
    },
}, (_a = class Mpris extends GObject.Object {
        static get_default() {
            if (!_a._instance)
                _a._instance = new _a();
            return _a._instance;
        }
        constructor() {
            super();
            this._players = new Map();
            // Deferred so the session-bus ListNames sync call doesn't block the
            // UI from becoming interactive at startup.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._connect();
                return GLib.SOURCE_REMOVE;
            });
        }
        get players() {
            return Array.from(this._players.values());
        }
        _addPlayer(name) {
            if (this._players.has(name))
                return;
            this._players.set(name, new Player(name));
        }
        _connect() {
            try {
                const dbusProxy = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null, "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", null);
                const result = dbusProxy.call_sync("ListNames", null, Gio.DBusCallFlags.NONE, -1, null);
                const [names] = result.deep_unpack();
                for (const name of names) {
                    if (name.startsWith(NAME_PREFIX))
                        this._addPlayer(name);
                }
                this.notify("players");
                dbusProxy.connect("g-signal", (_p, _sender, signal, params) => {
                    if (signal !== "NameOwnerChanged")
                        return;
                    const [name, oldOwner, newOwner] = params.deep_unpack();
                    if (!name.startsWith(NAME_PREFIX))
                        return;
                    if (newOwner && !oldOwner) {
                        this._addPlayer(name);
                        this.notify("players");
                    }
                    else if (!newOwner && oldOwner) {
                        if (this._players.delete(name))
                            this.notify("players");
                    }
                });
            }
            catch (e) {
                logError(e, "mpris: could not connect to session bus");
            }
        }
    },
    _a._instance = null,
    _a));
Mpris.PlaybackStatus = PlaybackStatus;
export default Mpris;
