import { Gtk } from "ags/gtk4"
import type { Block, Editor } from "./editor"

interface Tool {
    icon?: string
    label?: string
    tooltip: string
    run: (editor: Editor) => void
}

// Formatos de párrafo del menú.
const BLOCKS: [string, Block][] = [
    ["Texto", 0],
    ["Título 1", 1],
    ["Título 2", 2],
    ["Título 3", 3],
    ["Cita", "quote"],
]

// El de código no está en Papirus: va como texto. Los tooltips dicen también
// el atajo de Markdown que hace lo mismo al escribir.
const GROUPS: Tool[][] = [
    [
        { icon: "format-text-bold-symbolic", tooltip: "Negrita  (Ctrl+B o **texto**)", run: (e) => e.toggleInline("bold") },
        { icon: "format-text-italic-symbolic", tooltip: "Cursiva  (Ctrl+I o *texto*)", run: (e) => e.toggleInline("italic") },
        { icon: "format-text-strikethrough-symbolic", tooltip: "Tachado  (~~texto~~)", run: (e) => e.toggleInline("strike") },
        { label: "</>", tooltip: "Código  (`texto`)", run: (e) => e.toggleInline("code") },
    ],
    [
        { icon: "view-list-bullet-symbolic", tooltip: "Viñeta  (- al inicio)", run: (e) => e.toggleList("bullet") },
        { icon: "checkbox-checked-symbolic", tooltip: "Casilla  ([] al inicio; clic para marcarla)", run: (e) => e.toggleList("check") },
    ],
    [
        { icon: "format-indent-less-symbolic", tooltip: "Sacar de la subnota  (Shift+Tab)", run: (e) => e.shiftDepth(-1) },
        {
            icon: "format-indent-more-symbolic",
            tooltip: "Meter en la subnota de arriba  (Tab)\nUna línea que termina en «:» con líneas metidas debajo se vuelve subnota",
            run: (e) => e.shiftDepth(1),
        },
    ],
]

export default function Toolbar(view: Gtk.TextView, editor: () => Editor) {
    const bar = new Gtk.Box({ cssClasses: ["notes-toolbar"], spacing: 2 })
    let syncing = false

    const blocks = Gtk.DropDown.new_from_strings(BLOCKS.map(([name]) => name))
    blocks.cssClasses = ["notes-format"]
    blocks.tooltipText = "Formato del párrafo"
    blocks.focusOnClick = false
    blocks.connect("notify::selected", () => {
        if (syncing) return
        editor().setBlock(BLOCKS[blocks.selected][1])
        view.grab_focus()
    })
    bar.append(blocks)

    for (const group of GROUPS) {
        bar.append(new Gtk.Separator({ orientation: Gtk.Orientation.VERTICAL, cssClasses: ["notes-toolbar-sep"] }))
        for (const tool of group) {
            const btn = new Gtk.Button({
                cssClasses: ["notes-tool"],
                tooltipText: tool.tooltip,
                focusOnClick: false,
            })
            btn.set_child(
                tool.icon
                    ? new Gtk.Image({ iconName: tool.icon })
                    : new Gtk.Label({ label: tool.label, cssClasses: ["notes-tool-label"] }),
            )
            btn.connect("clicked", () => {
                tool.run(editor())
                view.grab_focus()
            })
            bar.append(btn)
        }
    }

    return {
        widget: bar,
        // El menú muestra el formato de la línea del cursor.
        sync(block: Block) {
            const index = BLOCKS.findIndex(([, b]) => b === block)
            if (blocks.selected === index) return
            syncing = true
            blocks.selected = index
            syncing = false
        },
    }
}
