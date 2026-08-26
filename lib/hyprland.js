var _a;
// Lightweight stand-in for AstalHyprland, talking to Hyprland's own IPC
// (hyprctl + the .socket2.sock event stream) directly. AstalHyprland's native
// binding is only available bundled with an old, unrelated astal-libs build
// and drifts out of sync with the system's actual astal/Hyprland versions —
// this avoids that dependency entirely.
import GObject from "gi://GObject";
import GLib from "gi://GLib?version=2.0";
import Gio from "gi://Gio?version=2.0";
function hyprctlJson(...args) {
    try {
        const proc = Gio.Subprocess.new(["hyprctl", "-j", ...args], Gio.SubprocessFlags.STDOUT_PIPE);
        const [, stdout] = proc.communicate_utf8(null, null);
        return stdout ? JSON.parse(stdout) : null;
    }
    catch (e) {
        logError(e, "hyprland: hyprctlJson failed");
        return null;
    }
}
// Hyprland >= 0.55's `hyprctl dispatch <str>` evaluates <str> as Lua
// (`hl.dispatch(<str>)`) instead of the old flat "dispatcher name + args" CLI
// syntax. Translate the handful of classic dispatcher calls this file makes
// into their hl.dsp.* equivalents so callers below can keep passing the old
// (name, args) shape unchanged.
function luaStr(s) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function luaWorkspace(s) {
    return /^-?\d+$/.test(s) ? s : luaStr(s);
}
function toLuaDispatchExpr(dispatcher, args) {
    switch (dispatcher) {
        case "workspace":
            return `hl.dsp.focus({ workspace = ${luaWorkspace(args)} })`;
        case "focuswindow":
            return `hl.dsp.focus({ window = ${luaStr(args)} })`;
        case "togglefloating":
            return args
                ? `hl.dsp.window.float({ action = "toggle", window = ${luaStr(args)} })`
                : `hl.dsp.window.float({ action = "toggle" })`;
        case "closewindow":
            return args ? `hl.dsp.window.close({ window = ${luaStr(args)} })` : `hl.dsp.window.close()`;
        case "movetoworkspacesilent": {
            const [workspace, window] = args.split(/,(?=address:)/);
            return `hl.dsp.window.move({ workspace = ${luaWorkspace(workspace)}, follow = false, window = ${luaStr(window)} })`;
        }
        case "movetoworkspace": {
            const [workspace, window] = args.split(/,(?=address:)/);
            return `hl.dsp.window.move({ workspace = ${luaWorkspace(workspace)}, window = ${luaStr(window)} })`;
        }
        default:
            return null;
    }
}
function hyprctlDispatch(dispatcher, args = "") {
    const expr = toLuaDispatchExpr(dispatcher, args);
    if (!expr) {
        logError(new Error(`unknown dispatcher "${dispatcher}"`), "hyprland: dispatch failed");
        return;
    }
    try {
        // hyprctl prints "ok" on success; pipe it instead of NONE so it doesn't
        // leak into whatever terminal ags happens to be attached to.
        Gio.Subprocess.new(["hyprctl", "dispatch", expr], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    }
    catch (e) {
        logError(e, "hyprland: dispatch failed");
    }
}
export class Client {
    constructor(data) {
        this.address = data?.address || "";
        this.class = data?.class || "";
        this.title = data?.title || "";
        this.workspace = { id: data?.workspace?.id ?? 0, name: data?.workspace?.name ?? "" };
    }
    focus() {
        hyprctlDispatch("focuswindow", `address:${this.address}`);
    }
}
const Hyprland = GObject.registerClass({
    GTypeName: "ShiroHyprland",
    Properties: {
        clients: GObject.ParamSpec.jsobject("clients", "clients", "clients", GObject.ParamFlags.READABLE),
        "focused-client": GObject.ParamSpec.jsobject("focused-client", "focused-client", "focused-client", GObject.ParamFlags.READABLE),
        "focused-workspace": GObject.ParamSpec.jsobject("focused-workspace", "focused-workspace", "focused-workspace", GObject.ParamFlags.READABLE),
    },
}, (_a = class Hyprland extends GObject.Object {
        static get_default() {
            if (!_a._instance)
                _a._instance = new _a();
            return _a._instance;
        }
        constructor() {
            super();
            this._clients = [];
            this._focusedClient = null;
            this._focusedWorkspace = { id: 1, name: "1" };
            this._refreshPending = false;
            // Deferred: `_refresh()` shells out to `hyprctl` synchronously,
            // which would otherwise block the UI from becoming interactive
            // at startup.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._refresh();
                this._listen();
                return GLib.SOURCE_REMOVE;
            });
        }
        get clients() {
            return this._clients;
        }
        get focusedClient() {
            return this._focusedClient;
        }
        get focusedWorkspace() {
            return this._focusedWorkspace;
        }
        dispatch(dispatcher, args = "") {
            hyprctlDispatch(dispatcher, args);
        }
        get_cursor_position() {
            const pos = hyprctlJson("cursorpos");
            return { x: pos?.x ?? 0, y: pos?.y ?? 0 };
        }
        _refresh() {
            const rawClients = hyprctlJson("clients") || [];
            this._clients = rawClients.map((c) => new Client(c));
            const rawActive = hyprctlJson("activewindow");
            this._focusedClient = rawActive?.address
                ? this._clients.find((c) => c.address === rawActive.address) || new Client(rawActive)
                : null;
            const rawWs = hyprctlJson("activeworkspace");
            if (rawWs)
                this._focusedWorkspace = { id: rawWs.id, name: rawWs.name };
            this.notify("clients");
            this.notify("focused-client");
            this.notify("focused-workspace");
        }
        // Hyprland's event socket can fire several events in a burst (e.g. on
        // workspace switch: workspace>>, activewindow>>, focusedmon>>). Debounce
        // so a single burst triggers one hyprctl round-trip, not three.
        _scheduleRefresh() {
            if (this._refreshPending)
                return;
            this._refreshPending = true;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
                this._refreshPending = false;
                this._refresh();
                return GLib.SOURCE_REMOVE;
            });
        }
        _listen() {
            const sigDir = `${GLib.getenv("XDG_RUNTIME_DIR")}/hypr/${GLib.getenv("HYPRLAND_INSTANCE_SIGNATURE")}`;
            const sockPath = `${sigDir}/.socket2.sock`;
            const connect = () => {
                try {
                    const address = Gio.UnixSocketAddress.new(sockPath);
                    const client = new Gio.SocketClient();
                    const conn = client.connect(address, null);
                    const dis = new Gio.DataInputStream({ base_stream: conn.get_input_stream() });
                    const readLine = () => {
                        dis.read_line_async(GLib.PRIORITY_DEFAULT, null, (_src, res) => {
                            let line;
                            try {
                                ;
                                [line] = dis.read_line_finish_utf8(res);
                            }
                            catch (e) {
                                line = null;
                            }
                            if (line === null) {
                                // Socket closed — Hyprland reloaded or restarted. Retry shortly.
                                GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                                    connect();
                                    return GLib.SOURCE_REMOVE;
                                });
                                return;
                            }
                            this._scheduleRefresh();
                            readLine();
                        });
                    };
                    readLine();
                }
                catch (e) {
                    logError(e, "hyprland: could not connect to event socket, retrying");
                    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
                        connect();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            };
            connect();
        }
    },
    _a._instance = null,
    _a));
export default Hyprland;
