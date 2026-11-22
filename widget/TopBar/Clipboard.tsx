import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import { execAsync } from "ags/process"
import { MenuPopover } from "../Shared/MenuPopover"

const SEND_SCRIPT = `${GLib.get_home_dir()}/.config/ags/scripts/clipboard-send.sh`
// Solo para el texto de ayuda: la máquina de destino la decide el script
const OTHER_NAME = GLib.get_host_name() === "CachyOS-Laptop" ? "la PC" : "la laptop"

// Cómo mostrar cada entrada de cliphist: imagen, archivo o texto
function describe(text: string): { icon: string; label: string; sub: string } {
    const img = text.match(/^\[\[ binary data ([\d.]+ \w+) (\w+) (\d+x\d+) \]\]$/)
    if (img) return { icon: "image-x-generic-symbolic", label: `Imagen ${img[2].toUpperCase()}`, sub: `${img[3].replace("x", " × ")} · ${img[1]}` }
    if (text.startsWith("[[ binary data")) return { icon: "application-x-executable-symbolic", label: "Datos binarios", sub: text.replace(/^\[\[ binary data |\]\]$/g, "") }
    const t = text.trim()
    if (/^(\/|~\/|file:\/\/)\S+$/.test(t)) {
        const path = t.replace(/^file:\/\//, "")
        const name = path.split("/").filter(Boolean).pop() || path
        const dir = path.slice(0, path.length - name.length).replace(GLib.get_home_dir(), "~")
        return { icon: "text-x-generic-symbolic", label: name, sub: dir }
    }
    if (/^https?:\/\//.test(t)) return { icon: "web-browser-symbolic", label: t.replace(/^https?:\/\/(www\.)?/, ""), sub: "" }
    return { icon: "format-justify-left-symbolic", label: t.replace(/\s+/g, " ").substring(0, 80), sub: "" }
}

export default function Clipboard() {
    const list = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.NONE, cssClasses: ["clipboard-list"] })

    const rows: {
        row: Gtk.ListBoxRow, btn: Gtk.Button, label: Gtk.Label, sub: Gtk.Label, kind: Gtk.Image, handler: number | null,
        sendBtn: Gtk.Button, sendHandler: number | null,
    }[] = []
    for (let i = 0; i < 10; i++) {
        const row = new Gtk.ListBoxRow({ visible: false })
        const btn = new Gtk.Button({ cssClasses: ["popover-item", "clip-item"], hexpand: true })
        const label = new Gtk.Label({ xalign: 0, ellipsize: 3, maxWidthChars: 22, cssClasses: ["clip-item-label"] })
        const sub = new Gtk.Label({ xalign: 0, ellipsize: 1, maxWidthChars: 22, cssClasses: ["clip-item-sub"], visible: false })
        const kind = new Gtk.Image({ cssClasses: ["clip-item-kind"], valign: Gtk.Align.CENTER })
        const texts = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, hexpand: true, valign: Gtk.Align.CENTER })
        texts.append(label)
        texts.append(sub)
        const inner = new Gtk.Box({ spacing: 10 })
        inner.append(kind)
        inner.append(texts)
        btn.set_child(inner)
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
        rows.push({ row, btn, label, sub, kind, handler: null, sendBtn, sendHandler: null })
    }

    const empty = new Gtk.Label({ label: "Nada copiado todavía", cssClasses: ["clip-empty"], visible: false, vexpand: true })
    // Margen derecho: la barra de scroll flotante tapaba el botón de enviar
    const listBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, cssClasses: ["clip-list-box"] })
    listBox.append(empty)
    listBox.append(list)

    const scrolled = new Gtk.ScrolledWindow({ vexpand: true, hscrollbarPolicy: Gtk.PolicyType.NEVER })
    scrolled.set_size_request(-1, 120)  // el alto lo da .topbar-menu.tall
    scrolled.set_child(listBox)
    const count = new Gtk.Label({ label: "" })

    const menubutton = new Gtk.MenuButton()
    menubutton.set_child(new Gtk.Image({ iconName: "edit-copy-symbolic" }))

    const popover = MenuPopover(menubutton, [
        {
            title: "Portapapeles",
            titleIcon: "edit-paste-symbolic",
            titleExtra: count,
            customChild: scrolled
        }
    ])
    menubutton.set_popover(popover)

    const updateList = async () => {
        try {
            const output = await execAsync("cliphist list")
            const items = output.split("\n").filter(Boolean).slice(0, 10)
            count.label = items.length ? `${items.length} recientes` : ""
            empty.visible = items.length === 0

            rows.forEach((r, i) => {
                if (items[i]) {
                    const [id, ...textParts] = items[i].split("\t")
                    const d = describe(textParts.join("\t"))
                    r.label.label = d.label
                    r.sub.label = d.sub
                    r.sub.visible = d.sub !== ""
                    r.kind.icon_name = d.icon

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
                    r.sub.visible = false
                    r.kind.icon_name = "dialog-warning-symbolic"
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

    popover.add_css_class("topbar-menu")  // mismo ancho que los demás menús de la barra
    popover.add_css_class("tall")  // mismo alto que Bluetooth y Red
    return menubutton
}
