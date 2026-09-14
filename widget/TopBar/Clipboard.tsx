import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import { execAsync } from "ags/process"
import { MenuPopover } from "../Shared/MenuPopover"

const SEND_SCRIPT = `${GLib.get_home_dir()}/.config/ags/scripts/clipboard-send.sh`
// Solo para el texto de ayuda: la máquina de destino la decide el script
const OTHER_NAME = GLib.get_host_name() === "CachyOS-Laptop" ? "la PC" : "la laptop"

export default function Clipboard() {
    const list = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.NONE, cssClasses: ["clipboard-list"] })

    const rows: {
        row: Gtk.ListBoxRow, btn: Gtk.Button, label: Gtk.Label, handler: number | null,
        sendBtn: Gtk.Button, sendHandler: number | null,
    }[] = []
    for (let i = 0; i < 10; i++) {
        const row = new Gtk.ListBoxRow({ visible: false })
        const btn = new Gtk.Button({ cssClasses: ["popover-item"], hexpand: true })
        const label = new Gtk.Label({ xalign: 0, ellipsize: 3, cssClasses: ["clip-item-label"] })
        btn.set_child(label)
        const sendBtn = new Gtk.Button({
            iconName: "document-send-symbolic",
            tooltipText: `Enviar al portapapeles de ${OTHER_NAME}`,
            cssClasses: ["popover-icon-btn"],
            valign: Gtk.Align.CENTER,
        })
        const box = new Gtk.Box({ spacing: 4 })
        box.append(btn)
        box.append(sendBtn)
        row.set_child(box)
        list.append(row)
        rows.push({ row, btn, label, handler: null, sendBtn, sendHandler: null })
    }

    const scrolled = new Gtk.ScrolledWindow({ vexpand: true })
    scrolled.set_size_request(290, 200)
    scrolled.set_child(list)

    const menubutton = new Gtk.MenuButton()
    menubutton.set_child(new Gtk.Image({ iconName: "edit-copy-symbolic" }))

    const popover = MenuPopover(menubutton, [
        {
            title: "Portapapeles",
            customChild: scrolled
        }
    ])
    menubutton.set_popover(popover)

    const updateList = async () => {
        try {
            const output = await execAsync("cliphist list")
            const items = output.split("\n").filter(Boolean).slice(0, 10)

            rows.forEach((r, i) => {
                if (items[i]) {
                    const [id, ...textParts] = items[i].split("\t")
                    r.label.label = textParts.join("\t").substring(0, 60)

                    // Actualizar evento
                    if (r.handler !== null) r.btn.disconnect(r.handler)
                    r.handler = r.btn.connect("clicked", () => {
                        // El id va como argumento: cliphist 0.7 lo rechaza por stdin con salto de línea
                        execAsync(["bash", "-c", 'cliphist decode "$1" | wl-copy', "_", id])
                            .catch(e => logError(e, "clipboard: copy failed"))
                        popover.popdown()
                    })

                    // El script avisa con una notificación si llegó o por qué falló
                    if (r.sendHandler !== null) r.sendBtn.disconnect(r.sendHandler)
                    r.sendHandler = r.sendBtn.connect("clicked", async () => {
                        r.sendBtn.sensitive = false
                        try {
                            await execAsync(["bash", SEND_SCRIPT, id])
                        } catch (e) {
                            logError(e as Error, "clipboard: send to the other machine failed")
                        } finally {
                            r.sendBtn.sensitive = true
                        }
                    })
                    r.sendBtn.visible = true
                    r.row.visible = true
                } else {
                    r.row.visible = false
                }
            })
        } catch (e) {
            logError(e as Error, "clipboard: cliphist list failed")
            rows.forEach((r, i) => {
                if (i === 0) {
                    r.label.label = "cliphist no disponible"
                    r.sendBtn.visible = false
                    r.row.visible = true
                } else {
                    r.row.visible = false
                }
            })
        }
    }

    popover.connect("notify::visible", () => {
        if (popover.visible) updateList()
    })

    return menubutton
}
