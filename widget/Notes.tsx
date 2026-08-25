import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import Hyprland from "../lib/hyprland"
import { getNotes, updateNotes } from "../lib/notesStore"

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

    let marginLeft = stored.marginLeft
    let marginTop = stored.marginTop
    let width = stored.width
    let height = stored.height

    let dragStartLeft = marginLeft
    let dragStartTop = marginTop
    let dragStartWidth = width
    let dragStartHeight = height
    let dragStartCursorX = 0
    let dragStartCursorY = 0

    const buffer = new Gtk.TextBuffer({ text: stored.text })
    buffer.connect("changed", () => {
        const [start, end] = buffer.get_bounds()
        updateNotes({ text: buffer.get_text(start, end, false) }, 600)
    })

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
                <box $={(ref: Gtk.Box) => (handle = ref)} cssClasses={["notes-handle"]}>
                    <label label="✎  Notas" hexpand halign={Gtk.Align.START} cssClasses={["notes-title"]} />
                </box>
                <scrolledwindow vexpand hexpand cssClasses={["notes-scroll"]}>
                    <Gtk.TextView
                        buffer={buffer}
                        wrapMode={Gtk.WrapMode.WORD_CHAR}
                        cssClasses={["notes-textview"]}
                        topMargin={8}
                        bottomMargin={8}
                        leftMargin={10}
                        rightMargin={10}
                    />
                </scrolledwindow>
                <box halign={Gtk.Align.END} cssClasses={["notes-resize-zone"]}>
                    <box $={(ref: Gtk.Box) => (grip = ref)} cssClasses={["notes-resize-grip"]} />
                </box>
            </box>
        </Astal.Window>
    )

    handle!.add_controller(moveGesture)
    grip!.add_controller(resizeGesture)

    win!.show()

    return notesWindow
}
