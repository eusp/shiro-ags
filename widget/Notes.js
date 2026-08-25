import { jsx as _jsx, jsxs as _jsxs } from "ags/gtk4/jsx-runtime";
import app from "ags/gtk4/app";
import { Astal, Gtk } from "ags/gtk4";
import Hyprland from "gi://AstalHyprland";
import { getNotes, updateNotes } from "../lib/notesStore";
const MIN_WIDTH = 180;
const MIN_HEIGHT = 140;
const hyprland = Hyprland.get_default();
export default function Notes(gdkmonitor) {
    const { TOP, LEFT } = Astal.WindowAnchor;
    const stored = getNotes();
    let win;
    let noteBox;
    let handle;
    let grip;
    let marginLeft = stored.marginLeft;
    let marginTop = stored.marginTop;
    let width = stored.width;
    let height = stored.height;
    let dragStartLeft = marginLeft;
    let dragStartTop = marginTop;
    let dragStartWidth = width;
    let dragStartHeight = height;
    let dragStartCursorX = 0;
    let dragStartCursorY = 0;
    const buffer = new Gtk.TextBuffer({ text: stored.text });
    buffer.connect("changed", () => {
        const [start, end] = buffer.get_bounds();
        updateNotes({ text: buffer.get_text(start, end, false) }, 600);
    });
    // GestureDrag's own offsetX/offsetY are measured in the window's local
    // surface coordinates, which shift as we move the window itself — feeding
    // that back into the margin creates a feedback loop where the widget
    // under/over-corrects and visibly lags the cursor. Hyprland's global
    // cursor position is compositor-authoritative and immune to that.
    const moveGesture = new Gtk.GestureDrag();
    moveGesture.connect("drag-begin", () => {
        dragStartLeft = marginLeft;
        dragStartTop = marginTop;
        const cursor = hyprland.get_cursor_position();
        dragStartCursorX = cursor.x;
        dragStartCursorY = cursor.y;
    });
    moveGesture.connect("drag-update", () => {
        const cursor = hyprland.get_cursor_position();
        marginLeft = Math.max(0, Math.round(dragStartLeft + (cursor.x - dragStartCursorX)));
        marginTop = Math.max(0, Math.round(dragStartTop + (cursor.y - dragStartCursorY)));
        win.marginLeft = marginLeft;
        win.marginTop = marginTop;
    });
    moveGesture.connect("drag-end", () => {
        updateNotes({ marginLeft, marginTop });
    });
    const resizeGesture = new Gtk.GestureDrag();
    resizeGesture.connect("drag-begin", () => {
        dragStartWidth = width;
        dragStartHeight = height;
        const cursor = hyprland.get_cursor_position();
        dragStartCursorX = cursor.x;
        dragStartCursorY = cursor.y;
    });
    resizeGesture.connect("drag-update", () => {
        const cursor = hyprland.get_cursor_position();
        width = Math.max(MIN_WIDTH, Math.round(dragStartWidth + (cursor.x - dragStartCursorX)));
        height = Math.max(MIN_HEIGHT, Math.round(dragStartHeight + (cursor.y - dragStartCursorY)));
        noteBox.set_size_request(width, height);
    });
    resizeGesture.connect("drag-end", () => {
        updateNotes({ width, height });
    });
    const notesWindow = (_jsx(Astal.Window, { "$": (ref) => (win = ref), name: "notes", cssClasses: ["Notes"], visible: false, gdkmonitor: gdkmonitor, application: app, exclusivity: Astal.Exclusivity.IGNORE, anchor: TOP | LEFT, layer: Astal.Layer.BOTTOM, keymode: Astal.Keymode.ON_DEMAND, marginTop: marginTop, marginLeft: marginLeft, children: _jsxs("box", { "$": (ref) => (noteBox = ref), orientation: Gtk.Orientation.VERTICAL, cssClasses: ["notes-container"], widthRequest: width, heightRequest: height, children: [_jsx("box", { "$": (ref) => (handle = ref), cssClasses: ["notes-handle"], children: _jsx("label", { label: "\u270E  Notas", hexpand: true, halign: Gtk.Align.START, cssClasses: ["notes-title"] }) }), _jsx("scrolledwindow", { vexpand: true, hexpand: true, cssClasses: ["notes-scroll"], children: _jsx(Gtk.TextView, { buffer: buffer, wrapMode: Gtk.WrapMode.WORD_CHAR, cssClasses: ["notes-textview"], topMargin: 8, bottomMargin: 8, leftMargin: 10, rightMargin: 10 }) }), _jsx("box", { halign: Gtk.Align.END, cssClasses: ["notes-resize-zone"], children: _jsx("box", { "$": (ref) => (grip = ref), cssClasses: ["notes-resize-grip"] }) })] }) }));
    handle.add_controller(moveGesture);
    grip.add_controller(resizeGesture);
    win.show();
    return notesWindow;
}
