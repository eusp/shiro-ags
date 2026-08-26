var _a;
// Lightweight stand-in for AstalWp: controls audio via `wpctl` (WirePlumber's
// own CLI) and watches `pactl subscribe` for change events, instead of
// relying on astal's native binding (only available bundled with an old,
// unrelated astal-libs build that drifts out of sync with the system's
// actual astal version). WirePlumber has no simple D-Bus API to talk to
// directly — this mirrors how most non-astal status bars integrate with it.
import GObject from "gi://GObject";
import GLib from "gi://GLib?version=2.0";
import Gio from "gi://Gio?version=2.0";
function runSync(argv) {
    try {
        const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE);
        const [, stdout] = proc.communicate_utf8(null, null);
        return stdout || "";
    }
    catch (e) {
        logError(e, `wp: command failed: ${argv.join(" ")}`);
        return "";
    }
}
function runAsync(argv) {
    try {
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
    }
    catch (e) {
        logError(e, `wp: command failed: ${argv.join(" ")}`);
    }
}
function volumeIconFor(volume, muted) {
    if (muted || volume <= 0)
        return "audio-volume-muted-symbolic";
    if (volume < 0.34)
        return "audio-volume-low-symbolic";
    if (volume < 0.67)
        return "audio-volume-medium-symbolic";
    return "audio-volume-high-symbolic";
}
const VOLUME_RE = /Volume:\s*([\d.]+)/;
const Endpoint = GObject.registerClass({
    GTypeName: "ShiroWpEndpoint",
    Properties: {
        volume: GObject.ParamSpec.jsobject("volume", "", "", GObject.ParamFlags.READWRITE),
        mute: GObject.ParamSpec.jsobject("mute", "", "", GObject.ParamFlags.READWRITE),
    },
}, class Endpoint extends GObject.Object {
    constructor(kind) {
        super();
        // 0 means "no default device found" — mirrors AstalWp's `.id !== 0` presence check.
        this.id = 0;
        this._volume = 0;
        this._mute = false;
        this._kind = kind;
        this.refresh();
    }
    get volume() {
        return this._volume;
    }
    set volume(v) {
        this.set_volume(v);
    }
    get mute() {
        return this._mute;
    }
    set mute(v) {
        runAsync(["wpctl", "set-mute", this._target(), v ? "1" : "0"]);
        this._mute = v;
        this.notify("mute");
    }
    get volumeIcon() {
        return volumeIconFor(this._volume, this._mute);
    }
    set_volume(v) {
        const clamped = Math.max(0, Math.min(1, v));
        runAsync(["wpctl", "set-volume", this._target(), clamped.toFixed(2)]);
        this._volume = clamped;
        this.notify("volume");
    }
    refresh() {
        const out = runSync(["wpctl", "get-volume", this._target()]);
        const match = out.match(VOLUME_RE);
        const newId = match ? 1 : 0;
        const newVolume = match ? parseFloat(match[1]) : 0;
        const newMute = out.includes("[MUTED]");
        const changed = newId !== this.id || newVolume !== this._volume || newMute !== this._mute;
        this.id = newId;
        this._volume = newVolume;
        this._mute = newMute;
        if (changed) {
            this.notify("volume");
            this.notify("mute");
        }
    }
    _target() {
        return this._kind === "sink" ? "@DEFAULT_AUDIO_SINK@" : "@DEFAULT_AUDIO_SOURCE@";
    }
});
const Wp = GObject.registerClass({
    GTypeName: "ShiroWp",
}, (_a = class Wp extends GObject.Object {
        static get_default() {
            if (!_a._instance)
                _a._instance = new _a();
            return _a._instance;
        }
        constructor() {
            super();
            this.defaultSpeaker = new Endpoint("sink");
            this.defaultMicrophone = new Endpoint("source");
            this._watch();
        }
        _watch() {
            try {
                const proc = Gio.Subprocess.new(["pactl", "subscribe"], Gio.SubprocessFlags.STDOUT_PIPE);
                const stream = new Gio.DataInputStream({ base_stream: proc.get_stdout_pipe() });
                const readLine = () => {
                    stream.read_line_async(GLib.PRIORITY_DEFAULT, null, (_src, res) => {
                        let line;
                        try {
                            ;
                            [line] = stream.read_line_finish_utf8(res);
                        }
                        catch (e) {
                            line = null;
                        }
                        if (line === null)
                            return; // `pactl subscribe` exited — give up quietly.
                        if (/sink|source|server/i.test(line)) {
                            this.defaultSpeaker.refresh();
                            this.defaultMicrophone.refresh();
                        }
                        readLine();
                    });
                };
                readLine();
            }
            catch (e) {
                logError(e, "wp: could not start pactl subscribe");
            }
        }
    },
    _a._instance = null,
    _a));
export default Wp;
