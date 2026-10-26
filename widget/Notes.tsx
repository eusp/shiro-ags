import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import Pango from "gi://Pango"
import Hyprland from "../lib/hyprland"
import { type NoteNode, getNotes, updateNotes } from "../lib/notesStore"
import { parse, toTree, isSubnoteNode, nodeTitle } from "./Notes/outline"
import { type Editor, createEditor, TEXT_MARGIN } from "./Notes/editor"
import Toolbar from "./Notes/Toolbar"

const MIN_WIDTH = 180
const MIN_HEIGHT = 140

const hyprland = Hyprland.get_default()

export default function Notes(gdkmonitor: Gdk.Monitor) {
    const { TOP, LEFT } = Astal.WindowAnchor
    const stored = getNotes()

    let win: Astal.Window
    let noteBox: Gtk.Box
    let handle: Gtk.Box
    let grip: Gtk.Box
    let backButton: Gtk.Button
    let titleLabel: Gtk.Label
    let doneButton: Gtk.Button
    let doneIcon: Gtk.Image
    let doneCount: Gtk.Label

    let marginLeft = stored.marginLeft
    let marginTop = stored.marginTop
    let width = stored.width
    let height = stored.height
    let showDone = stored.showDone

    let dragStartLeft = marginLeft
    let dragStartTop = marginTop
    let dragStartWidth = width
    let dragStartHeight = height
    let dragStartCursorX = 0
    let dragStartCursorY = 0

    // ─── Editor ──────────────────────────────────────────────────────────────
    // El árbol de notas es la fuente de verdad; editor.ts lo muestra en el
    // TextView como texto enriquecido y lo vuelve a armar al editar.

    // notes.json de antes guardaba toda la nota como un string.
    let notes: NoteNode[] = stored.text !== undefined ? toTree(parse(stored.text).roots) : stored.notes

    const view = new Gtk.TextView({
        wrapMode: Gtk.WrapMode.WORD_CHAR,
        cssClasses: ["notes-textview"],
        topMargin: 14,
        bottomMargin: 14,
        leftMargin: TEXT_MARGIN,
        rightMargin: TEXT_MARGIN,
        vexpand: true,
        hexpand: true,
    })
    // Toma el color de acento del tema para los tags (ver editor.ts).
    const accentProbe = new Gtk.Label({ cssClasses: ["notes-accent-probe"] })
    let editor: Editor
    const toolbar = Toolbar(view, () => editor)

    editor = createEditor(view, accentProbe, {
        getNotes: () => notes,
        setNotes(next) {
            notes = next
            updateNotes({ notes, text: undefined }, 600)
        },
        showDone: () => showDone,
        onState({ path, hidable }) {
            const crumbs = path.filter(isSubnoteNode).map(nodeTitle)
            titleLabel.label = ["✎  Notas", ...crumbs].join("  ›  ")
            backButton.visible = path.length > 0

            doneButton.visible = hidable > 0
            doneIcon.iconName = showDone ? "view-conceal-symbolic" : "view-reveal-symbolic"
            doneCount.label = `${hidable}`
            doneButton.tooltipText = showDone ? "Ocultar completadas" : `Mostrar ${hidable} completadas ocultas`
        },
        onCursorBlock: (block) => toolbar.sync(block),
    })

    const goBack = () => editor.back()

    // Clic en una subnota plegada la abre; clic en ☐ la marca.
    const click = new Gtk.GestureClick({ propagationPhase: Gtk.PropagationPhase.CAPTURE })
    click.connect("pressed", (_g, nPress, x, y) => {
        if (nPress !== 1) return
        const target = editor.hit(x, y)
        if (!target) return
        click.set_state(Gtk.EventSequenceState.CLAIMED)
        if (target.kind === "checkbox") editor.toggleCheckbox(target.line)
        else editor.openAt(target.line)
    })
    view.add_controller(click)

    const motion = new Gtk.EventControllerMotion()
    motion.connect("motion", (_c, x, y) => {
        view.set_cursor_from_name(editor.hit(x, y) ? "pointer" : "text")
    })
    view.add_controller(motion)

    // En captura, para ganarle al TextView (que con Tab mete un tabulador).
    const keys = new Gtk.EventControllerKey({ propagationPhase: Gtk.PropagationPhase.CAPTURE })
    keys.connect("key-pressed", (_c, keyval, _code, state) => {
        const ctrl = (state & Gdk.ModifierType.CONTROL_MASK) !== 0
        const shift = (state & Gdk.ModifierType.SHIFT_MASK) !== 0
        switch (keyval) {
            case Gdk.KEY_Escape:
                if (!editor.isOpen()) return false
                goBack()
                return true
            case Gdk.KEY_Tab:
                editor.shiftDepth(shift ? -1 : 1)
                return true
            case Gdk.KEY_ISO_Left_Tab:
                editor.shiftDepth(-1)
                return true
            case Gdk.KEY_BackSpace:
                return editor.backspaceOutdents()
            case Gdk.KEY_b:
            case Gdk.KEY_B:
                if (!ctrl) return false
                editor.toggleInline("bold")
                return true
            case Gdk.KEY_i:
            case Gdk.KEY_I:
                if (!ctrl) return false
                editor.toggleInline("italic")
                return true
        }
        return false
    })
    view.add_controller(keys)

    // ─── Mover y redimensionar ───────────────────────────────────────────────

    // GestureDrag's own offsetX/offsetY are measured in the window's local
    // surface coordinates, which shift as we move the window itself — feeding
    // that back into the margin creates a feedback loop where the widget
    // under/over-corrects and visibly lags the cursor. Hyprland's global
    // cursor position is compositor-authoritative and immune to that.
    const moveGesture = new Gtk.GestureDrag()
    moveGesture.connect("drag-begin", () => {
        dragStartLeft = marginLeft
        dragStartTop = marginTop
        const cursor = hyprland.get_cursor_position()
        dragStartCursorX = cursor.x
        dragStartCursorY = cursor.y
    })
    moveGesture.connect("drag-update", () => {
        const cursor = hyprland.get_cursor_position()
        marginLeft = Math.max(0, Math.round(dragStartLeft + (cursor.x - dragStartCursorX)))
        marginTop = Math.max(0, Math.round(dragStartTop + (cursor.y - dragStartCursorY)))
        win.marginLeft = marginLeft
        win.marginTop = marginTop
    })
    moveGesture.connect("drag-end", () => {
        updateNotes({ marginLeft, marginTop })
    })

    const resizeGesture = new Gtk.GestureDrag()
    resizeGesture.connect("drag-begin", () => {
        dragStartWidth = width
        dragStartHeight = height
        const cursor = hyprland.get_cursor_position()
        dragStartCursorX = cursor.x
        dragStartCursorY = cursor.y
    })
    resizeGesture.connect("drag-update", () => {
        const cursor = hyprland.get_cursor_position()
        width = Math.max(MIN_WIDTH, Math.round(dragStartWidth + (cursor.x - dragStartCursorX)))
        height = Math.max(MIN_HEIGHT, Math.round(dragStartHeight + (cursor.y - dragStartCursorY)))
        noteBox.set_size_request(width, height)
    })
    resizeGesture.connect("drag-end", () => {
        updateNotes({ width, height })
    })

    const toggleDone = () => {
        showDone = !showDone
        updateNotes({ showDone })
        editor.rerender()
    }

    const notesWindow = (
        <Astal.Window
            $={(ref: Astal.Window) => (win = ref)}
            name="notes"
            cssClasses={["Notes"]}
            visible={false}
            gdkmonitor={gdkmonitor}
            application={app}
            exclusivity={Astal.Exclusivity.IGNORE}
            anchor={TOP | LEFT}
            layer={Astal.Layer.BOTTOM}
            keymode={Astal.Keymode.ON_DEMAND}
            marginTop={marginTop}
            marginLeft={marginLeft}
        >
            <box
                $={(ref: Gtk.Box) => (noteBox = ref)}
                orientation={Gtk.Orientation.VERTICAL}
                cssClasses={["notes-container"]}
                widthRequest={width}
                heightRequest={height}
            >
                <box $={(ref: Gtk.Box) => (handle = ref)} cssClasses={["notes-handle"]} spacing={4}>
                    <button
                        $={(ref: Gtk.Button) => (backButton = ref)}
                        cssClasses={["notes-header-button"]}
                        tooltipText="Volver  (Esc)"
                        visible={false}
                        onClicked={goBack}
                    >
                        <image iconName="go-previous-symbolic" />
                    </button>
                    <label
                        $={(ref: Gtk.Label) => (titleLabel = ref)}
                        label="✎  Notas"
                        hexpand
                        halign={Gtk.Align.START}
                        ellipsize={Pango.EllipsizeMode.START}
                        cssClasses={["notes-title"]}
                    />
                    <button
                        $={(ref: Gtk.Button) => (doneButton = ref)}
                        cssClasses={["notes-header-button"]}
                        visible={false}
                        onClicked={toggleDone}
                    >
                        <box spacing={3}>
                            <image $={(ref: Gtk.Image) => (doneIcon = ref)} iconName="view-reveal-symbolic" />
                            <label $={(ref: Gtk.Label) => (doneCount = ref)} cssClasses={["notes-done-count"]} />
                        </box>
                    </button>
                    {accentProbe}
                </box>
                {toolbar.widget}
                <scrolledwindow vexpand hexpand cssClasses={["notes-scroll"]}>
                    {view}
                </scrolledwindow>
                <box halign={Gtk.Align.END} cssClasses={["notes-resize-zone"]}>
                    <box $={(ref: Gtk.Box) => (grip = ref)} cssClasses={["notes-resize-grip"]} />
                </box>
            </box>
        </Astal.Window>
    )

    // Sin tamaño por defecto, GTK deja la ventana del tamaño que ya tenía
    // aunque el contenido pida menos: al achicarla no se veía el cambio hasta
    // moverla. Con 1x1 se ajusta siempre al tamaño pedido por noteBox.
    win!.set_default_size(1, 1)
    handle!.add_controller(moveGesture)
    grip!.add_controller(resizeGesture)

    editor.load()
    win!.show()

    return notesWindow
}
