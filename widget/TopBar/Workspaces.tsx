import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib?version=2.0"
import Hyprland, { Client } from "../../lib/hyprland"
import { MenuPopover } from "../Shared/MenuPopover"
import { resolveAppIcon } from "../../lib/icons"

const hypr = Hyprland.get_default()

// Mismo icono real (a color) que la sidebar — ver lib/icons.ts. Se
// cachea por clase de ventana porque la búsqueda del .desktop no es
// gratis y este preview se reconstruye en cada hover.
const iconCache = new Map<string, string>()

function iconForClass(wmClass: string): string {
    if (!wmClass) return "application-x-executable"
    const cached = iconCache.get(wmClass)
    if (cached) return cached

    const found = resolveAppIcon(wmClass)
    iconCache.set(wmClass, found)
    return found
}

export default function Workspaces() {
    const buttons: Gtk.Button[] = []
    const circles: Gtk.Box[] = []
    const previews: Gtk.Popover[] = []
    const list = <box spacing={8} cssClasses={["workspaces"]} /> as Gtk.Box

    // Máximo 4 apps por columna; de ahí en más, apila una columna nueva a
    // la derecha en vez de seguir estirando la misma hacia abajo.
    const MAX_PER_COLUMN = 4

    const buildPreview = (wsNumber: number, previewBox: Gtk.Box) => {
        while (previewBox.get_first_child()) previewBox.remove(previewBox.get_first_child()!)

        const clients: Client[] = (hypr.clients || []).filter(c => c.workspace.id === wsNumber)

        let column: Gtk.Box | null = null
        clients.forEach((c, idx) => {
            if (idx % MAX_PER_COLUMN === 0) {
                column = new Gtk.Box({
                    orientation: Gtk.Orientation.VERTICAL,
                    spacing: 6,
                    widthRequest: 40,
                })
                previewBox.append(column)
            }

            const img = new Gtk.Image({
                iconName: iconForClass(c.class),
                pixelSize: 18,
                tooltipText: c.title || c.class,
            })
            // Mismo color/transparencia de reposo que la sidebar, pero con
            // el borde izquierdo y las esquinas redondeadas siempre
            // visibles (acá no hay hover que las active).
            const item = new Gtk.Box({ cssClasses: ["ws-preview-item"], halign: Gtk.Align.CENTER })
            item.append(img)
            column!.append(item)
        })
        return clients.length > 0
    }

    // ── Cantidad de workspaces: mínimo 5, se guarda entre sesiones ──
    const MIN_COUNT = 5
    const COUNT_FILE = `${GLib.get_user_state_dir()}/shiro-ags/workspaces`
    const readCount = () => {
        try {
            const [ok, data] = GLib.file_get_contents(COUNT_FILE)
            const n = ok ? parseInt(new TextDecoder().decode(data), 10) : NaN
            return Number.isFinite(n) ? Math.max(MIN_COUNT, n) : MIN_COUNT
        } catch { return MIN_COUNT }
    }
    const saveCount = (n: number) => {
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(COUNT_FILE), 0o755)
            GLib.file_set_contents(COUNT_FILE, String(n))
        } catch (e) { logError(e as Error, "workspaces: no se pudo guardar la cantidad") }
    }

    const makeDot = (wsNumber: number) => {
        const dot = <box cssClasses={["dot"]} /> as Gtk.Box
        dot.set_size_request(6, 10)

        // El círculo visible (.ws-dot) vive en una caja interna,
        // chica y centrada — el botón que la envuelve ocupa toda
        // la altura de la topbar (sin verse) para que el popover,
        // que se ancla al botón, salga pegado al borde de la barra
        // en vez de justo debajo del puntito.
        const circle = <box
            cssClasses={["ws-dot"]}
            halign={Gtk.Align.CENTER}
            valign={Gtk.Align.CENTER}
        >
            {dot}
        </box> as Gtk.Box
        circle.set_size_request(12, 12)

        const btn = <button
            cssClasses={["ws-dot-btn"]}
            valign={Gtk.Align.FILL}
            vexpand
            onClicked={() => hypr.dispatch("workspace", String(wsNumber))}
        >
            {circle}
        </button> as Gtk.Button

        // Fila de columnas de íconos (cada columna se arma en
        // buildPreview, máximo 4 apps cada una), misma pinta que el
        // resto de popovers (sale pegado por debajo de la topbar).
        const previewBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 4,
            cssClasses: ["ws-preview"],
        })
        const preview = MenuPopover(btn, [{ customChild: previewBox }])
        // Sin autohide: es un preview pasivo, no un menú. Con
        // autohide activo (el default), abrir el popover le roba el
        // grab del puntero al botón, lo que genera un "leave"
        // sintético sobre él — y eso vuelve a cerrarlo, que genera
        // un "enter" de nuevo, en un parpadeo infinito.
        preview.set_autohide(false)
        preview.set_can_target(false)

        const hover = new Gtk.EventControllerMotion()
        hover.connect("enter", () => {
            if (buildPreview(wsNumber, previewBox)) preview.popup()
        })
        hover.connect("leave", () => preview.popdown())
        btn.add_controller(hover)

        buttons.push(btn)
        circles.push(circle)
        previews.push(preview)
        list.insert_child_after(btn, buttons.length > 1 ? buttons[buttons.length - 2] : null)
    }

    const removeLastDot = () => {
        const btn = buttons.pop()!
        circles.pop()
        previews.pop()?.unparent()
        list.remove(btn)
    }

    // ── Cruz "+": clic agrega, clic derecho quita el último ──
    const addIcon = <image cssClasses={["ws-add"]} iconName="list-add-symbolic" pixelSize={10} valign={Gtk.Align.CENTER} /> as Gtk.Image
    const addBtn = <button
        cssClasses={["ws-dot-btn"]}
        valign={Gtk.Align.FILL}
        vexpand
        onClicked={() => setCount(buttons.length + 1)}
    >
        {addIcon}
    </button> as Gtk.Button
    const rightClick = new Gtk.GestureClick({ button: 3 })
    rightClick.connect("pressed", () => removeLast())
    addBtn.add_controller(rightClick)
    list.append(addBtn)

    const updateAddTooltip = () => addBtn.set_tooltip_text(
        buttons.length > MIN_COUNT
            ? "Clic: agregar workspace · Clic derecho: quitar el último"
            : "Agregar workspace",
    )

    function setCount(n: number) {
        n = Math.max(MIN_COUNT, n)
        while (buttons.length < n) makeDot(buttons.length + 1)
        while (buttons.length > n) removeLastDot()
        saveCount(n)
        updateAddTooltip()
        update()
    }

    // Quita el último workspace: sus ventanas pasan al anterior y, si
    // estabas en él, te lleva al anterior.
    function removeLast() {
        const last = buttons.length
        if (last <= MIN_COUNT) return
        const target = last - 1
        for (const c of hypr.clients || []) {
            if (c.workspace.id === last) hypr.dispatch("movetoworkspacesilent", `${target},address:${c.address}`)
        }
        if (hypr.focusedWorkspace.id === last) hypr.dispatch("workspace", String(target))
        setCount(target)
    }

    const update = () => {
        const current = hypr.focusedWorkspace.id

        // .active va en el círculo (ahí vive .ws-dot), no en el botón.
        circles.forEach((circle, index) => {
            const wsNumber = index + 1
            if (wsNumber === current) {
                circle.add_css_class("active")
            } else {
                circle.remove_css_class("active")
            }
        })
    }

    // El preview de cada workspace se arma al vuelo con hypr.clients justo
    // cuando entra el hover (buildPreview), así que no hace falta
    // suscribirse a notify::clients aquí.
    // Si se llegó a un workspace más alto (atajo de teclado), se agregan sus
    // puntos. Solo aquí, no en update(): al quitar el último, el foco viejo
    // todavía no se actualizó y lo volvería a agregar.
    const handlerId = hypr.connect("notify::focused-workspace", () => {
        const current = hypr.focusedWorkspace.id
        if (current > buttons.length && current <= 20) setCount(current)
        else update()
    })

    list.connect("destroy", () => {
        hypr.disconnect(handlerId)
    })

    setCount(readCount())

    return list
}
