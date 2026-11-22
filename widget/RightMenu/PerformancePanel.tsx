import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib?version=2.0"
import { execAsync } from "ags/process"

// Panel "Rendimiento" del menú derecho. Compacto: barras de CPU, RAM, GPU y
// VRAM con las temperaturas en el encabezado. Detalles (desplegable): datos
// extra de cada uno y los errores del driver NVIDIA desde el arranque.
// Solo consulta mientras el menú está visible.

const POLL_MS = 2000
const DRIVER_CHECK_MS = 10000
const GPU_QUERY = "name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed"
// Errores de memoria de video como los que precedieron al cuelgue de Hyprland
const DRIVER_ERR = "NVRM.*(VA space|Out of memory|Xid|intermapRegisterDmaMapping)"

// Detalles abiertos: RightMenu oculta temas y apps para dejarles espacio
const perfExpandedSubs: ((v: boolean) => void)[] = []
let perfExpandedValue = false
export const perfExpanded = {
    get: () => perfExpandedValue,
    set: (v: boolean) => { perfExpandedValue = v; perfExpandedSubs.forEach(fn => fn(v)) },
    subscribe: (fn: (v: boolean) => void) => { perfExpandedSubs.push(fn) },
}

// El uso de GPU que da nvidia-smi es instantáneo y salta mucho (18, 40, 16…);
// se muestra el promedio de las últimas lecturas (≈8 s).
const GPU_SMOOTH = 4
const gpuSamples: number[] = []
function smoothGpu(v: number): number {
    gpuSamples.push(v)
    if (gpuSamples.length > GPU_SMOOTH) gpuSamples.shift()
    return gpuSamples.reduce((a, b) => a + b, 0) / gpuSamples.length
}

type Level = "" | "warn" | "crit"
const level = (f: number, warn: number, crit: number): Level => f >= crit ? "crit" : f >= warn ? "warn" : ""

function readFile(path: string): string {
    try {
        const [ok, bytes] = GLib.file_get_contents(path)
        if (ok && bytes) return new TextDecoder().decode(bytes)
    } catch { }
    return ""
}

// ─── Lecturas del sistema ────────────────────────────────────────────────────

let lastCpu: { idle: number; total: number } | null = null
// % de CPU desde la lectura anterior (no desde el arranque)
function cpuUsage(): number {
    const f = readFile("/proc/stat").split("\n")[0].split(/\s+/).slice(1).map(Number)
    const idle = f[3] + (f[4] || 0)
    const total = f.reduce((a, b) => a + b, 0)
    const prev = lastCpu
    lastCpu = { idle, total }
    if (!prev || total === prev.total) return 0
    return 1 - (idle - prev.idle) / (total - prev.total)
}

function memInfo() {
    const t = readFile("/proc/meminfo")
    const kb = (k: string) => parseInt(t.match(new RegExp(`${k}:\\s+(\\d+)`))?.[1] || "0", 10)
    const total = kb("MemTotal"), avail = kb("MemAvailable")
    const swapTotal = kb("SwapTotal"), swapFree = kb("SwapFree")
    return { used: total - avail, total, cache: kb("Cached") + kb("Buffers"), swapUsed: swapTotal - swapFree, swapTotal }
}

// Sensor de temperatura de la CPU (coretemp en Intel, k10temp en AMD)
const cpuTempPath = (() => {
    for (let i = 0; i < 16; i++) {
        const dir = `/sys/class/hwmon/hwmon${i}`
        const name = readFile(`${dir}/name`).trim()
        if (name === "coretemp" || name === "k10temp" || name === "zenpower") return `${dir}/temp1_input`
    }
    return ""
})()
const cpuTemp = () => cpuTempPath ? Math.round(parseInt(readFile(cpuTempPath), 10) / 1000) : NaN

function cpuFreqGHz(): number {
    const mhz = [...readFile("/proc/cpuinfo").matchAll(/cpu MHz\s*:\s*([\d.]+)/g)].map(m => Number(m[1]))
    return mhz.length ? mhz.reduce((a, b) => a + b, 0) / mhz.length / 1000 : NaN
}

const cpuModel = (() => {
    const m = readFile("/proc/cpuinfo").match(/model name\s*:\s*(.+)/)?.[1] ?? "CPU"
    return m.replace(/\(R\)|\(TM\)|CPU|@.*$/g, "").replace(/\s+/g, " ").trim()
})()

const gb = (kb: number) => (kb / 1024 / 1024).toFixed(1)

// ─── Piezas de UI ────────────────────────────────────────────────────────────

// Barra fina dibujada con el `color` CSS del widget (sigue al tema y a .warn/.crit)
function Bar() {
    let fraction = 0
    const area = new Gtk.DrawingArea({ hexpand: true, heightRequest: 5, valign: Gtk.Align.CENTER, cssClasses: ["perf-bar"] })
    area.set_draw_func((_a, cr, w, h) => {
        const c = area.get_color()
        const r = h / 2
        const pill = (width: number) => {
            cr.newPath()
            cr.arc(r, r, r, Math.PI / 2, 3 * Math.PI / 2)
            cr.arc(Math.max(r, width - r), r, r, -Math.PI / 2, Math.PI / 2)
            cr.closePath()
        }
        pill(w)
        cr.setSourceRGBA(c.red, c.green, c.blue, 0.15)
        cr.fill()
        if (fraction > 0) {
            pill(Math.max(h, w * fraction))
            cr.setSourceRGBA(c.red, c.green, c.blue, 0.9)
            cr.fill()
        }
    })
    return {
        widget: area,
        set(f: number, lvl: Level = "") {
            fraction = Math.min(1, Math.max(0, f))
            area.set_css_classes(lvl ? ["perf-bar", lvl] : ["perf-bar"])
            area.queue_draw()
        },
    }
}

// Fila compacta: nombre | barra | valor. Anchos fijos para que todas las
// barras midan lo mismo.
function Row(name: string) {
    const bar = Bar()
    const value = new Gtk.Label({ cssClasses: ["perf-value"], xalign: 1, widthRequest: 76 })
    const row = new Gtk.Box({ spacing: 10 })
    row.append(new Gtk.Label({ label: name, cssClasses: ["perf-label"], xalign: 0, widthRequest: 34 }))
    row.append(bar.widget)
    row.append(value)
    return { widget: row, bar, value }
}

// Bloque de detalles: título + líneas "clave  valor"
function DetailBlock(title: string) {
    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 3, cssClasses: ["perf-detail"] })
    const titleLabel = new Gtk.Label({ label: title, cssClasses: ["perf-detail-title"], xalign: 0, ellipsize: 3 })
    box.append(titleLabel)
    const lines = new Map<string, Gtk.Label>()
    return {
        widget: box,
        title: (t: string) => titleLabel.set_label(t),
        set(key: string, val: string) {
            let label = lines.get(key)
            if (!label) {
                const row = new Gtk.Box({ spacing: 8 })
                row.append(new Gtk.Label({ label: key, cssClasses: ["perf-detail-key"], xalign: 0, hexpand: true }))
                label = new Gtk.Label({ cssClasses: ["perf-detail-val"], xalign: 1 })
                row.append(label)
                box.append(row)
                lines.set(key, label)
            }
            label.set_label(val)
        },
    }
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export default function PerformancePanel() {
    // Encabezado: misma fila que "Tema" (etiqueta · valor · flecha); abre los detalles
    const temps = new Gtk.Label({ cssClasses: ["perf-temps"] })
    const warnIcon = new Gtk.Label({
        label: "⚠",
        cssClasses: ["perf-warn"],
        visible: false,
        tooltipText: "El driver de NVIDIA registró errores: abre los detalles para verlos",
    })
    const arrow = new Gtk.Label({ label: "›", cssClasses: ["perf-arrow"] })

    const headerInner = new Gtk.Box({ spacing: 8 })
    headerInner.append(new Gtk.Label({ label: "Rendimiento", cssClasses: ["perf-title"], xalign: 0, hexpand: true }))
    headerInner.append(warnIcon)
    headerInner.append(temps)
    headerInner.append(arrow)
    const header = new Gtk.Button({ cssClasses: ["perf-toggle"], child: headerInner, tooltipText: "Ver detalles" })

    // Filas compactas
    const cpu = Row("CPU")
    const ram = Row("RAM")
    const gpu = Row("GPU")
    const vram = Row("VRAM")
    const rows = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 })
    for (const r of [cpu, ram, gpu, vram]) rows.append(r.widget)

    const gpuError = new Gtk.Label({
        cssClasses: ["perf-error"],
        xalign: 0,
        wrap: true,
        maxWidthChars: 36,
        visible: false,
        label: "nvidia-smi no responde. Si se actualizó el driver, reinicia la PC.",
    })

    // Detalles
    const cpuD = DetailBlock(`${cpuModel} · ${GLib.get_num_processors()} hilos`)
    const ramD = DetailBlock("Memoria")
    const gpuD = DetailBlock("GPU")

    const errTitle = new Gtk.Label({ label: "Errores del driver NVIDIA", cssClasses: ["perf-detail-title", "warn"], xalign: 0 })
    const errInfo = new Gtk.Label({
        cssClasses: ["perf-detail-note"],
        xalign: 0,
        wrap: true,
        maxWidthChars: 36,
        label: "La GPU se quedó sin espacio para memoria de video. Es el bug que congeló la imagen en Star Rail; si se repite seguido, baja los gráficos o cierra el juego.",
    })
    const errList = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2 })
    const errBlock = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4, cssClasses: ["perf-detail"], visible: false })
    errBlock.append(errTitle)
    errBlock.append(errList)
    errBlock.append(errInfo)

    const details = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 10, cssClasses: ["perf-details"] })
    details.append(cpuD.widget)
    details.append(ramD.widget)
    details.append(gpuD.widget)
    details.append(errBlock)

    const detailsScroll = new Gtk.ScrolledWindow({
        hscrollbarPolicy: Gtk.PolicyType.NEVER,
        vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
        maxContentHeight: 520,
        propagateNaturalHeight: true,
        child: details,
    })
    const revealer = new Gtk.Revealer({
        transitionType: Gtk.RevealerTransitionType.SLIDE_DOWN,
        transitionDuration: 180,
        child: detailsScroll,
    })

    const setExpanded = (open: boolean) => {
        revealer.set_reveal_child(open)
        arrow.set_label(open ? "⌄" : "›")
        header.set_tooltip_text(open ? "Ocultar detalles" : "Ver detalles")
        open ? header.add_css_class("expanded") : header.remove_css_class("expanded")
        perfExpanded.set(open)
    }
    header.connect("clicked", () => setExpanded(!revealer.get_reveal_child()))

    const body = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 10, cssClasses: ["perf-body"] })
    body.append(rows)
    body.append(gpuError)
    body.append(revealer)

    const card = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, cssClasses: ["perf-panel"] })
    card.append(header)
    card.append(body)

    // ── Actualización ──
    let gpuTemp = NaN

    const updateTemps = () => {
        const ct = cpuTemp()
        const parts = []
        if (!isNaN(ct)) parts.push(`CPU ${ct}°`)
        if (!isNaN(gpuTemp)) parts.push(`GPU ${gpuTemp}°`)
        temps.set_label(parts.join("  "))
        const hot = Math.max(isNaN(ct) ? 0 : ct, isNaN(gpuTemp) ? 0 : gpuTemp)
        temps.set_css_classes(["perf-temps", ...(hot >= 85 ? ["crit"] : hot >= 75 ? ["warn"] : [])])
    }

    const pollLocal = () => {
        const c = cpuUsage()
        cpu.bar.set(c, level(c, 0.85, 0.95))
        cpu.value.set_label(`${Math.round(c * 100)}%`)

        const m = memInfo()
        const mf = m.used / m.total
        ram.bar.set(mf, level(mf, 0.85, 0.95))
        ram.value.set_label(`${gb(m.used)} / ${Math.round(m.total / 1024 / 1024)} GB`)

        if (revealer.get_reveal_child()) {
            const f = cpuFreqGHz()
            cpuD.set("Frecuencia media", isNaN(f) ? "—" : `${f.toFixed(2)} GHz`)
            cpuD.set("Carga 1/5/15 min", readFile("/proc/loadavg").split(" ").slice(0, 3).join(" / "))
            ramD.set("En uso", `${gb(m.used)} GB`)
            ramD.set("Caché", `${gb(m.cache)} GB`)
            ramD.set("Swap (zram)", m.swapTotal ? `${gb(m.swapUsed)} / ${gb(m.swapTotal)} GB` : "—")
        }
        updateTemps()
    }

    const pollGpu = () => {
        execAsync(["nvidia-smi", `--query-gpu=${GPU_QUERY}`, "--format=csv,noheader,nounits"])
            .then(out => {
                const [name, util, used, total, t, power, fan] = out.split("\n")[0].split(",").map(s => s.trim())
                const u = smoothGpu(Number(util)) / 100
                gpu.bar.set(u)
                gpu.value.set_label(`${Math.round(u * 100)}%`)
                const vf = Number(used) / Number(total)
                vram.bar.set(vf, level(vf, 0.8, 0.9))
                vram.value.set_label(`${(Number(used) / 1024).toFixed(1)} / ${Math.round(Number(total) / 1024)} GB`)
                gpuTemp = Math.round(Number(t))
                gpuD.title(name.replace(/^NVIDIA\s+(GeForce\s+)?/, ""))
                gpuD.set("Consumo", isNaN(Number(power)) ? "—" : `${Math.round(Number(power))} W`)
                gpuD.set("Ventilador", isNaN(Number(fan)) ? "—" : `${fan}%`)
                gpuD.set("VRAM", `${used} / ${total} MiB`)
                gpu.widget.set_visible(true)
                vram.widget.set_visible(true)
                gpuError.set_visible(false)
                updateTemps()
            })
            .catch(() => {
                gpuTemp = NaN
                gpu.widget.set_visible(false)
                vram.widget.set_visible(false)
                gpuError.set_visible(true)
                updateTemps()
            })
    }

    // Errores del driver agrupados por minuto: "10:28  ·  34 avisos"
    const checkDriver = () => {
        execAsync(["journalctl", "-k", "-b", "-q", "--no-pager", "-o", "short-iso", "-g", DRIVER_ERR])
            .then(out => {
                const byMinute = new Map<string, number>()
                for (const line of out.split("\n")) {
                    const hm = line.match(/T(\d\d:\d\d)/)?.[1]
                    if (hm) byMinute.set(hm, (byMinute.get(hm) ?? 0) + 1)
                }
                const total = [...byMinute.values()].reduce((a, b) => a + b, 0)
                warnIcon.set_visible(total > 0)
                errBlock.set_visible(total > 0)
                if (!total) return
                errTitle.set_label(`Errores del driver NVIDIA · ${total} desde el arranque`)
                let child = errList.get_first_child()
                while (child) { errList.remove(child); child = errList.get_first_child() }
                const recent = [...byMinute.entries()].slice(-5).reverse()
                for (const [hm, n] of recent) {
                    const row = new Gtk.Box({ spacing: 8 })
                    row.append(new Gtk.Label({ label: hm, cssClasses: ["perf-detail-key"], xalign: 0, widthRequest: 40 }))
                    row.append(new Gtk.Label({
                        label: n === 1 ? "1 error de memoria de video" : `${n} errores de memoria de video`,
                        cssClasses: ["perf-detail-val"],
                        xalign: 0,
                    }))
                    errList.append(row)
                }
                if (byMinute.size > recent.length) {
                    errList.append(new Gtk.Label({
                        label: `y ${byMinute.size - recent.length} episodios más antes`,
                        cssClasses: ["perf-detail-key"],
                        xalign: 0,
                    }))
                }
            })
            .catch(() => { warnIcon.set_visible(false); errBlock.set_visible(false) })
    }

    let sinceDriverCheck = 0
    const tick = () => { pollLocal(); pollGpu() }
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
        if (!card.get_mapped()) return GLib.SOURCE_CONTINUE
        tick()
        sinceDriverCheck += POLL_MS
        if (sinceDriverCheck >= DRIVER_CHECK_MS) { sinceDriverCheck = 0; checkDriver() }
        return GLib.SOURCE_CONTINUE
    })
    // Al abrir el menú, datos al instante en vez de esperar al siguiente ciclo
    card.connect("map", () => { tick(); checkDriver(); sinceDriverCheck = 0 })
    revealer.connect("notify::reveal-child", () => { if (revealer.get_reveal_child()) pollLocal() })
    cpuUsage()
    tick()

    return card
}
