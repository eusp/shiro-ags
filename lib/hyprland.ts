// Lightweight stand-in for AstalHyprland, talking to Hyprland's own IPC
// (hyprctl + the .socket2.sock event stream) directly. AstalHyprland's native
// binding is only available bundled with an old, unrelated astal-libs build
// and drifts out of sync with the system's actual astal/Hyprland versions —
// this avoids that dependency entirely.
import GObject from "gi://GObject"
import GLib from "gi://GLib?version=2.0"
import Gio from "gi://Gio?version=2.0"

export interface HyprWorkspace {
    id: number
    name: string
}

function hyprctlJson(...args: string[]): any {
    try {
        const proc = Gio.Subprocess.new(["hyprctl", "-j", ...args], Gio.SubprocessFlags.STDOUT_PIPE)
        const [, stdout] = proc.communicate_utf8(null, null)
        return stdout ? JSON.parse(stdout) : null
    } catch (e) {
        logError(e as Error, "hyprland: hyprctlJson failed")
        return null
    }
}

function hyprctlDispatch(dispatcher: string, args = "") {
    try {
        const argv = args ? ["hyprctl", "dispatch", dispatcher, args] : ["hyprctl", "dispatch", dispatcher]
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE)
    } catch (e) {
        logError(e as Error, "hyprland: dispatch failed")
    }
}

export class Client {
    address: string
    class: string
    title: string
    workspace: HyprWorkspace

    constructor(data: any) {
        this.address = data?.address || ""
        this.class = data?.class || ""
        this.title = data?.title || ""
        this.workspace = { id: data?.workspace?.id ?? 0, name: data?.workspace?.name ?? "" }
    }

    focus() {
        hyprctlDispatch("focuswindow", `address:${this.address}`)
    }
}

const Hyprland = GObject.registerClass(
    {
        GTypeName: "ShiroHyprland",
        Properties: {
            clients: GObject.ParamSpec.jsobject("clients", "clients", "clients", GObject.ParamFlags.READABLE),
            "focused-client": GObject.ParamSpec.jsobject(
                "focused-client", "focused-client", "focused-client", GObject.ParamFlags.READABLE,
            ),
            "focused-workspace": GObject.ParamSpec.jsobject(
                "focused-workspace", "focused-workspace", "focused-workspace", GObject.ParamFlags.READABLE,
            ),
        },
    },
    class Hyprland extends GObject.Object {
        static _instance: InstanceType<typeof Hyprland> | null = null
        static get_default() {
            if (!Hyprland._instance) Hyprland._instance = new Hyprland()
            return Hyprland._instance
        }

        private _clients: Client[] = []
        private _focusedClient: Client | null = null
        private _focusedWorkspace: HyprWorkspace = { id: 1, name: "1" }
        private _refreshPending = false

        constructor() {
            super()
            this._refresh()
            this._listen()
        }

        get clients() {
            return this._clients
        }

        get focusedClient() {
            return this._focusedClient
        }

        get focusedWorkspace() {
            return this._focusedWorkspace
        }

        dispatch(dispatcher: string, args = "") {
            hyprctlDispatch(dispatcher, args)
        }

        get_cursor_position() {
            const pos = hyprctlJson("cursorpos")
            return { x: pos?.x ?? 0, y: pos?.y ?? 0 }
        }

        private _refresh() {
            const rawClients: any[] = hyprctlJson("clients") || []
            this._clients = rawClients.map((c) => new Client(c))

            const rawActive = hyprctlJson("activewindow")
            this._focusedClient = rawActive?.address
                ? this._clients.find((c) => c.address === rawActive.address) || new Client(rawActive)
                : null

            const rawWs = hyprctlJson("activeworkspace")
            if (rawWs) this._focusedWorkspace = { id: rawWs.id, name: rawWs.name }

            this.notify("clients")
            this.notify("focused-client")
            this.notify("focused-workspace")
        }

        // Hyprland's event socket can fire several events in a burst (e.g. on
        // workspace switch: workspace>>, activewindow>>, focusedmon>>). Debounce
        // so a single burst triggers one hyprctl round-trip, not three.
        private _scheduleRefresh() {
            if (this._refreshPending) return
            this._refreshPending = true
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
                this._refreshPending = false
                this._refresh()
                return GLib.SOURCE_REMOVE
            })
        }

        private _listen() {
            const sigDir = `${GLib.getenv("XDG_RUNTIME_DIR")}/hypr/${GLib.getenv("HYPRLAND_INSTANCE_SIGNATURE")}`
            const sockPath = `${sigDir}/.socket2.sock`

            const connect = () => {
                try {
                    const address = Gio.UnixSocketAddress.new(sockPath)
                    const client = new Gio.SocketClient()
                    const conn = client.connect(address, null)
                    const dis = new Gio.DataInputStream({ base_stream: conn.get_input_stream() })

                    const readLine = () => {
                        dis.read_line_async(GLib.PRIORITY_DEFAULT, null, (_src, res) => {
                            let line: string | null
                            try {
                                ;[line] = dis.read_line_finish_utf8(res)
                            } catch (e) {
                                line = null
                            }

                            if (line === null) {
                                // Socket closed — Hyprland reloaded or restarted. Retry shortly.
                                GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                                    connect()
                                    return GLib.SOURCE_REMOVE
                                })
                                return
                            }

                            this._scheduleRefresh()
                            readLine()
                        })
                    }

                    readLine()
                } catch (e) {
                    logError(e as Error, "hyprland: could not connect to event socket, retrying")
                    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
                        connect()
                        return GLib.SOURCE_REMOVE
                    })
                }
            }

            connect()
        }
    },
)

export default Hyprland
