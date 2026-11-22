import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib?version=2.0"

// Calendario del popover del reloj (reemplaza a Gtk.Calendar).
// Semana de lunes a domingo, hoy en una píldora, fines de semana atenuados. Flechas o rueda del mouse cambian de mes.
// Siempre son 6 filas y el botón "Hoy" nunca se oculta: el popover vive en
// layer-shell y Hyprland lo cierra si cambia de tamaño estando abierto.

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"]

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export default function CalendarView() {
    const now = () => GLib.DateTime.new_now_local()
    let viewYear = now().get_year()
    let viewMonth = now().get_month()  // 1–12
    let selected: string | null = null  // "AAAA-MM-DD"

    // ── Encabezado ──
    const monthLabel = new Gtk.Label({ cssClasses: ["cal-month"], xalign: 0 })
    const yearLabel = new Gtk.Label({ cssClasses: ["cal-year"], xalign: 0, valign: Gtk.Align.BASELINE_FILL })
    monthLabel.set_valign(Gtk.Align.BASELINE_FILL)
    const titleBox = new Gtk.Box({ spacing: 8, hexpand: true })
    titleBox.append(monthLabel)
    titleBox.append(yearLabel)

    const navBtn = (icon: string, tooltip: string, onClick: () => void) => {
        const b = new Gtk.Button({ cssClasses: ["cal-nav"], tooltipText: tooltip, child: new Gtk.Image({ iconName: icon, pixelSize: 12 }) })
        b.connect("clicked", onClick)
        return b
    }
    const todayBtn = new Gtk.Button({ cssClasses: ["cal-today-btn"], label: "Hoy", tooltipText: "Volver al mes actual" })

    const header = new Gtk.Box({ spacing: 4, cssClasses: ["cal-header"] })
    header.append(titleBox)
    header.append(navBtn("go-previous-symbolic", "Mes anterior", () => shift(-1)))
    header.append(todayBtn)
    header.append(navBtn("go-next-symbolic", "Mes siguiente", () => shift(1)))

    // ── Cuadrícula ──
    // Fila de letras con líneas arriba y abajo; columnas homogéneas en ambas para que alineen
    const weekdays = new Gtk.Box({ cssClasses: ["cal-weekdays"], homogeneous: true, spacing: 2 })
    WEEKDAYS.forEach((d, i) => {
        weekdays.append(new Gtk.Label({ label: d, cssClasses: ["cal-weekday", ...(i >= 5 ? ["weekend"] : [])] }))
    })

    const grid = new Gtk.Grid({ cssClasses: ["cal-grid"], columnHomogeneous: true, vexpand: true, rowSpacing: 2, columnSpacing: 2 })

    const cells: { btn: Gtk.Button; label: Gtk.Label; date: GLib.DateTime | null }[] = []
    for (let row = 0; row < 6; row++) {
        for (let col = 0; col < 7; col++) {
            const label = new Gtk.Label()
            const btn = new Gtk.Button({ cssClasses: ["cal-day"], child: label, vexpand: true })  // las filas llenan el alto de la columna derecha
            const cell = { btn, label, date: null as GLib.DateTime | null }
            btn.connect("clicked", () => {
                if (!cell.date) return
                selected = cell.date.format("%Y-%m-%d")
                // Un día de otro mes lleva a ese mes
                if (cell.date.get_month() !== viewMonth) {
                    viewYear = cell.date.get_year()
                    viewMonth = cell.date.get_month()
                }
                render()
            })
            grid.attach(btn, col, row, 1, 1)
            cells.push(cell)
        }
    }

    const wheel = new Gtk.EventControllerScroll({ flags: Gtk.EventControllerScrollFlags.VERTICAL | Gtk.EventControllerScrollFlags.DISCRETE })
    wheel.connect("scroll", (_c, _dx, dy) => { if (dy !== 0) shift(dy > 0 ? 1 : -1); return true })
    grid.add_controller(wheel)

    function shift(months: number) {
        const total = viewYear * 12 + (viewMonth - 1) + months
        viewYear = Math.floor(total / 12)
        viewMonth = (total % 12) + 1
        render()
    }

    function render() {
        const today = now()
        const todayKey = today.format("%Y-%m-%d")
        const first = GLib.DateTime.new_local(viewYear, viewMonth, 1, 0, 0, 0)
        const start = first.add_days(-(first.get_day_of_week() - 1))!  // lunes de la 1ª semana

        monthLabel.set_label(capitalize(first.format("%B") ?? ""))
        yearLabel.set_label(String(viewYear))
        const onCurrent = viewYear === today.get_year() && viewMonth === today.get_month()
        todayBtn.set_sensitive(!onCurrent)

        cells.forEach((cell, i) => {
            const d = start.add_days(i)!
            cell.date = d
            cell.label.set_label(String(d.get_day_of_month()))
            const key = d.format("%Y-%m-%d")
            const cls = ["cal-day"]
            if (d.get_month() !== viewMonth) cls.push("other-month")
            if (d.get_day_of_week() >= 6) cls.push("weekend")
            if (key === todayKey) cls.push("today")
            if (key === selected && key !== todayKey) cls.push("selected")
            cell.btn.set_css_classes(cls)
            cell.btn.set_tooltip_text(capitalize(d.format("%A %d de %B") ?? ""))
        })
    }

    todayBtn.connect("clicked", () => reset())

    // Al abrir el popover: mes actual, sin selección
    function reset() {
        const t = now()
        viewYear = t.get_year()
        viewMonth = t.get_month()
        selected = null
        render()
    }

    render()

    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8, cssClasses: ["cal"] })
    box.append(header)
    box.append(weekdays)
    box.append(grid)
    return { widget: box, reset }
}
