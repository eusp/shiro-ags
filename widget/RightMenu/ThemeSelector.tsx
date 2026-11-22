import { Gtk, Gdk } from "ags/gtk4"
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import GdkPixbuf from "gi://GdkPixbuf"
import { execAsync } from "ags/process"

function makeVar<T>(initial: T) {
    let value = initial
    const subs: ((v: T) => void)[] = []
    return {
        get: () => value,
        set: (v: T) => { value = v; subs.forEach(fn => fn(v)) },
        subscribe: (fn: (v: T) => void) => { subs.push(fn) },
    }
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface ThemeColors {
    name: string
    base: string
    text: string
    subtext0: string
    surface0: string
    surface1: string
    surface2: string
    overlay0: string
    overlay1: string
    primary: string
    primaryAlt: string
    primaryMuted: string
    danger: string
    warning: string
    success: string
    info: string
    accent0: string
    accent1: string
    accent2: string
    accent3: string
    mantle: string
    crust: string
}

// ─── State ───────────────────────────────────────────────────────────────────

const SHIRO_DIR = `${GLib.get_home_dir()}/.config/shiro-theme`
const WALLPAPER_MODE_FILE = `${SHIRO_DIR}/wallpaper-mode`

type WallpaperMode = "animated" | "static"

const currentThemeName = makeVar(readCurrentTheme())
const isApplying = makeVar(false)
export const themeExpanded = makeVar(false)
const wallpaperMode = makeVar<WallpaperMode>(readWallpaperMode())

let activeThemeProvider: Gtk.CssProvider | null = null

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readCurrentTheme(): string {
    try {
        const [ok, bytes] = GLib.file_get_contents(`${SHIRO_DIR}/current-theme`)
        if (!ok) return "unknown"
        return new TextDecoder().decode(bytes).trim()
    } catch {
        return "unknown"
    }
}

function readWallpaperMode(): WallpaperMode {
    try {
        const [ok, bytes] = GLib.file_get_contents(WALLPAPER_MODE_FILE)
        if (!ok) return "animated"
        return new TextDecoder().decode(bytes).trim() === "static" ? "static" : "animated"
    } catch {
        return "animated"
    }
}

function hexToRgbParts(hex: string): [number, number, number] {
    if (!hex || hex.length < 7) return [0, 0, 0]
    return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
    ]
}

function hexToRgbStr(hex: string): string {
    const [r, g, b] = hexToRgbParts(hex)
    return `${r}, ${g}, ${b}`
}

function loadThemes(): { slug: string; data: ThemeColors }[] {
    const results: { slug: string; data: ThemeColors }[] = []
    try {
        const dir = Gio.File.new_for_path(`${SHIRO_DIR}/themes`)
        const enumerator = dir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null)
        let info: Gio.FileInfo | null
        while ((info = enumerator.next_file(null)) !== null) {
            const fname = info.get_name()
            if (!fname.endsWith(".json")) continue
            const slug = fname.slice(0, -5)
            try {
                const [ok, bytes] = GLib.file_get_contents(`${SHIRO_DIR}/themes/${fname}`)
                if (!ok) continue
                const data: ThemeColors = JSON.parse(new TextDecoder().decode(bytes))
                results.push({ slug, data })
            } catch { }
        }
    } catch { }
    results.sort((a, b) => a.slug.localeCompare(b.slug))
    // Active theme first
    const current = currentThemeName.get()
    const idx = results.findIndex(r => r.slug === current)
    if (idx > 0) results.unshift(results.splice(idx, 1)[0])
    return results
}

function buildCssVars(data: ThemeColors): string {
    const c = (hex: string) => hexToRgbStr(hex)
    return `
* {
  --base: ${data.base}; --base-rgb: ${c(data.base)};
  --text: ${data.text}; --text-rgb: ${c(data.text)};
  --subtext0: ${data.subtext0}; --subtext0-rgb: ${c(data.subtext0)};
  --surface0: ${data.surface0}; --surface0-rgb: ${c(data.surface0)};
  --surface1: ${data.surface1}; --surface1-rgb: ${c(data.surface1)};
  --surface2: ${data.surface2}; --surface2-rgb: ${c(data.surface2)};
  --overlay0: ${data.overlay0}; --overlay0-rgb: ${c(data.overlay0)};
  --overlay1: ${data.overlay1}; --overlay1-rgb: ${c(data.overlay1)};
  --primary: ${data.primary}; --primary-rgb: ${c(data.primary)};
  --primary-alt: ${data.primaryAlt}; --primary-alt-rgb: ${c(data.primaryAlt)};
  --primary-muted: ${data.primaryMuted}; --primary-muted-rgb: ${c(data.primaryMuted)};
  --danger: ${data.danger}; --danger-rgb: ${c(data.danger)};
  --warning: ${data.warning}; --warning-rgb: ${c(data.warning)};
  --success: ${data.success}; --success-rgb: ${c(data.success)};
  --info: ${data.info}; --info-rgb: ${c(data.info)};
  --accent0: ${data.accent0}; --accent0-rgb: ${c(data.accent0)};
  --accent1: ${data.accent1}; --accent1-rgb: ${c(data.accent1)};
  --accent2: ${data.accent2}; --accent2-rgb: ${c(data.accent2)};
  --accent3: ${data.accent3}; --accent3-rgb: ${c(data.accent3)};
  --mantle: ${data.mantle}; --mantle-rgb: ${c(data.mantle)};
  --crust: ${data.crust}; --crust-rgb: ${c(data.crust)};
}
`
}

function hotReload(data: ThemeColors) {
    const display = Gdk.Display.get_default()
    if (!display) return
    if (activeThemeProvider) {
        Gtk.StyleContext.remove_provider_for_display(display, activeThemeProvider)
    }
    const provider = new Gtk.CssProvider()
    const cssVars = buildCssVars(data)
    try {
        provider.load_from_string(cssVars)
    } catch {
        const bytes = new TextEncoder().encode(cssVars)
        ;(provider as any).load_from_data(bytes, bytes.length)
    }
    // Must be > STYLE_PROVIDER_PRIORITY_USER (800) to override AGS's CSS load
    Gtk.StyleContext.add_provider_for_display(display, provider, 900)
    activeThemeProvider = provider
}

function reloadWallpaper() {
    const script = `${GLib.get_home_dir()}/.config/hypr/scripts/change-wallpaper.sh`
    execAsync(["bash", script]).catch(() => { })
}

function applyTheme(slug: string, data: ThemeColors, mode: WallpaperMode) {
    if (isApplying.get()) return
    isApplying.set(true)
    hotReload(data)
    currentThemeName.set(slug)
    GLib.file_set_contents(`${SHIRO_DIR}/current-theme`, slug)
    wallpaperMode.set(mode)
    GLib.file_set_contents(WALLPAPER_MODE_FILE, mode)
    execAsync(`node ${SHIRO_DIR}/build.js`)
        .then(() => {
            execAsync(["hyprctl", "reload"]).catch(() => { })
            reloadWallpaper()
            // Apply boot theme (GRUB or Limine) with sudo (requires sudoers rule — see shiro-theme README)
            execAsync(["sudo", "-n", "node", `${SHIRO_DIR}/build-boot.js`]).catch(() => { })
        })
        .catch(() => { })
        .finally(() => isApplying.set(false))
}


// ─── Layout ──────────────────────────────────────────────────────────────────
// Vista previa grande con flechas, paleta en el borde inferior, modo y Aplicar.
// Elegir un tema (flechas o rueda) solo lo previsualiza; se aplica con el botón.

type Var<T> = ReturnType<typeof makeVar<T>>

function wallpaperPath(slug: string, ext: "png" | "mp4") {
    return `${SHIRO_DIR}/wallpapers/${slug}.${ext}`
}

function hasFile(path: string) {
    return GLib.file_test(path, GLib.FileTest.EXISTS)
}

// Proporción de la pantalla (16:10 en la PC, la que toque en la laptop), para
// que la vista previa recorte igual que hyprpaper al poner el fondo.
function screenAspect(): number {
    const monitors = Gdk.Display.get_default()?.get_monitors()
    const mon = monitors?.get_item(0) as Gdk.Monitor | null
    const geo = mon?.get_geometry()
    return geo && geo.height > 0 ? geo.width / geo.height : 16 / 10
}

// Wallpapers reducidos una sola vez (ancho 640, sin deformar) y cacheados
const pixbufCache = new Map<string, GdkPixbuf.Pixbuf | null>()
function wallpaperPixbuf(slug: string): GdkPixbuf.Pixbuf | null {
    if (!pixbufCache.has(slug)) {
        let pb: GdkPixbuf.Pixbuf | null = null
        const png = wallpaperPath(slug, "png")
        if (hasFile(png)) {
            try { pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(png, 640, -1, true) }
            catch (e) { console.warn(`[Theme:${slug}] no se pudo cargar el wallpaper:`, e) }
        }
        pixbufCache.set(slug, pb)
    }
    return pixbufCache.get(slug) ?? null
}

// Dibuja el wallpaper cubriendo w×h centrado (como hyprpaper); sin wallpaper,
// el color base del tema con una franja de su color principal.
function paintTheme(cr: any, slug: string, data: ThemeColors, w: number, h: number) {
    const pb = wallpaperPixbuf(slug)
    if (pb) {
        const pw = pb.get_width(), ph = pb.get_height()
        const s = Math.max(w / pw, h / ph)
        cr.save()
        cr.translate((w - pw * s) / 2, (h - ph * s) / 2)
        cr.scale(s, s)
        Gdk.cairo_set_source_pixbuf(cr, pb, 0, 0)
        cr.paint()
        cr.restore()
        return
    }
    const [r1, g1, b1] = hexToRgbParts(data.base)
    const [r2, g2, b2] = hexToRgbParts(data.primary)
    cr.setSourceRGB(r1 / 255, g1 / 255, b1 / 255)
    cr.paint()
    cr.moveTo(w * 0.45, 0); cr.lineTo(w, 0); cr.lineTo(w, h); cr.lineTo(w * 0.15, h)
    cr.closePath()
    cr.setSourceRGBA(r2 / 255, g2 / 255, b2 / 255, 0.35)
    cr.fill()
}

function NavArrow(label: string, tooltip: string, halign: Gtk.Align, onClick: () => void): Gtk.Button {
    const btn = new Gtk.Button({
        cssClasses: ["theme-nav-arrow"],
        tooltipText: tooltip,
        halign,
        valign: Gtk.Align.CENTER,
        child: new Gtk.Label({ label }),
    })
    btn.connect("clicked", onClick)
    return btn
}

// ─── Vista previa ────────────────────────────────────────────────────────────

function Preview(themes: { slug: string; data: ThemeColors }[], selected: Var<number>): Gtk.Widget {
    const aspect = screenAspect()
    const FADE_MS = 200

    // El alto sigue al ancho real para mantener la proporción de la pantalla
    const image = new Gtk.DrawingArea({ hexpand: true, cssClasses: ["theme-preview-image"] })
    image.set_content_height(Math.round(300 / aspect))
    image.connect("resize", (_a, w) => {
        const want = Math.round(w / aspect)
        if (image.get_content_height() !== want)
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { image.set_content_height(want); return false })
    })

    // Fundido entre el tema anterior y el nuevo
    let shown = selected.get()
    let previous = -1
    let fadeStart = 0
    image.set_draw_func((_a, cr, w, h) => {
        const t = previous < 0 ? 1 : Math.min(1, (GLib.get_monotonic_time() / 1000 - fadeStart) / FADE_MS)
        if (t < 1) paintTheme(cr, themes[previous].slug, themes[previous].data, w, h)
        cr.pushGroup()
        paintTheme(cr, themes[shown].slug, themes[shown].data, w, h)
        cr.popGroupToSource()
        cr.paintWithAlpha(t)
    })
    const fadeTo = (idx: number) => {
        if (idx === shown) return
        previous = shown
        shown = idx
        fadeStart = GLib.get_monotonic_time() / 1000
        image.add_tick_callback(() => {
            image.queue_draw()
            const done = GLib.get_monotonic_time() / 1000 - fadeStart >= FADE_MS
            if (done) previous = -1
            return !done
        })
    }

    const step = (d: number) => selected.set((selected.get() + d + themes.length) % themes.length)

    const nameLabel = new Gtk.Label({ xalign: 0, hexpand: true, cssClasses: ["theme-preview-name"] })
    const badge = new Gtk.Label({ label: "activo", cssClasses: ["theme-preview-badge"], valign: Gtk.Align.CENTER })
    const caption = new Gtk.Box({ cssClasses: ["theme-preview-caption"], valign: Gtk.Align.END, spacing: 6, canTarget: false })
    caption.append(nameLabel)
    caption.append(badge)

    const overlay = new Gtk.Overlay({ cssClasses: ["theme-preview"], overflow: Gtk.Overflow.HIDDEN, hexpand: true })
    overlay.set_child(image)
    overlay.add_overlay(caption)
    overlay.add_overlay(NavArrow("‹", "Tema anterior", Gtk.Align.START, () => step(-1)))
    overlay.add_overlay(NavArrow("›", "Tema siguiente", Gtk.Align.END, () => step(1)))

    // Rueda del mouse sobre la vista previa = cambiar de tema
    const wheel = new Gtk.EventControllerScroll({ flags: Gtk.EventControllerScrollFlags.VERTICAL | Gtk.EventControllerScrollFlags.DISCRETE })
    wheel.connect("scroll", (_c, _dx, dy) => { if (dy !== 0) step(dy > 0 ? 1 : -1); return true })
    overlay.add_controller(wheel)

    const update = () => {
        const idx = selected.get()
        const { slug, data } = themes[idx]
        fadeTo(idx)
        nameLabel.set_label(data.name || slug)
        badge.set_visible(slug === currentThemeName.get())
    }
    update()
    selected.subscribe(update)
    currentThemeName.subscribe(update)
    return overlay
}

// ─── Modo de fondo + Aplicar ─────────────────────────────────────────────────

function ModeSwitch(themes: { slug: string; data: ThemeColors }[], selected: Var<number>, mode: Var<WallpaperMode>): Gtk.Widget {
    const make = (m: WallpaperMode, icon: string) => {
        const btn = new Gtk.Button({
            cssClasses: ["theme-mode-btn"],
            child: new Gtk.Image({ iconName: icon, pixelSize: 13 }),
        })
        btn.connect("clicked", () => mode.set(m))
        return btn
    }
    const animated = make("animated", "video-x-generic-symbolic")
    const still = make("static", "image-x-generic-symbolic")
    still.set_tooltip_text("Fondo estático (.png)")

    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, cssClasses: ["theme-mode-switch"], spacing: 2 })
    box.append(animated)
    box.append(still)

    // Lo que eligió el usuario; un tema sin .mp4 fuerza "estático" solo mientras
    // está seleccionado, y al volver a uno con video se recupera esta elección.
    let userChoice = mode.get()
    const canAnimate = () => hasFile(wallpaperPath(themes[selected.get()].slug, "mp4"))
    mode.subscribe(m => { if (canAnimate()) userChoice = m })

    const update = () => {
        const animatable = canAnimate()
        animated.set_sensitive(animatable)
        animated.set_tooltip_text(animatable ? "Fondo animado (.mp4)" : "Este tema no tiene fondo animado")
        const want = animatable ? userChoice : "static"
        if (mode.get() !== want) { mode.set(want); return }
        const m = mode.get()
        m === "animated" ? animated.add_css_class("active") : animated.remove_css_class("active")
        m === "static" ? still.add_css_class("active") : still.remove_css_class("active")
    }
    update()
    selected.subscribe(update)
    mode.subscribe(update)
    return box
}

// ─── Columna lateral: número, paleta y modo ─────────────────────────────────

function SidePanel(themes: { slug: string; data: ThemeColors }[], selected: Var<number>, mode: Var<WallpaperMode>): Gtk.Widget {
    const counter = new Gtk.Label({ cssClasses: ["theme-side-counter"] })

    // Paleta: círculos con los colores principales, en columna
    const DOT = 10, GAP = 5
    const colorsOf = (d: ThemeColors) => [d.primary, d.primaryAlt, d.accent0, d.accent1, d.accent2, d.accent3]
    const palette = new Gtk.DrawingArea({
        widthRequest: DOT + 2,
        heightRequest: 6 * DOT + 5 * GAP,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
        vexpand: true,
        tooltipText: "Paleta del tema",
    })
    palette.set_draw_func((_a, cr, w) => {
        colorsOf(themes[selected.get()].data).forEach((hex, i) => {
            const [r, g, b] = hexToRgbParts(hex)
            cr.arc(w / 2, i * (DOT + GAP) + DOT / 2, DOT / 2, 0, 2 * Math.PI)
            cr.setSourceRGB(r / 255, g / 255, b / 255)
            cr.fillPreserve()
            cr.setSourceRGBA(1, 1, 1, 0.12)
            cr.setLineWidth(1)
            cr.stroke()
        })
    })

    const col = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, cssClasses: ["theme-side"], spacing: 8 })
    col.append(counter)
    col.append(palette)
    col.append(ModeSwitch(themes, selected, mode))

    const update = () => {
        counter.set_label(`${selected.get() + 1}/${themes.length}`)
        palette.queue_draw()
    }
    update()
    selected.subscribe(update)
    return col
}

function ApplyButton(themes: { slug: string; data: ThemeColors }[], selected: Var<number>, mode: Var<WallpaperMode>): Gtk.Widget {
    const label = new Gtk.Label()
    const btn = new Gtk.Button({ cssClasses: ["theme-apply-btn"], child: label })
    btn.connect("clicked", () => {
        const { slug, data } = themes[selected.get()]
        applyTheme(slug, data, mode.get())
    })
    const update = () => {
        const isCurrent = themes[selected.get()].slug === currentThemeName.get()
            && mode.get() === wallpaperMode.get()
        if (isApplying.get()) label.set_label("Aplicando…")
        else if (isCurrent) label.set_label("Tema actual")
        else label.set_label("Aplicar tema")
        btn.set_sensitive(!isApplying.get() && !isCurrent)
    }
    update()
    selected.subscribe(update)
    mode.subscribe(update)
    currentThemeName.subscribe(update)
    wallpaperMode.subscribe(update)
    isApplying.subscribe(update)
    return btn
}

// ─── Widget principal ────────────────────────────────────────────────────────

export default function ThemeSelector() {
    const themes = loadThemes()
    const startIdx = Math.max(0, themes.findIndex(t => t.slug === currentThemeName.get()))
    const selected = makeVar(startIdx)
    const pendingMode = makeVar<WallpaperMode>(wallpaperMode.get())

    // Botón que abre/cierra el panel
    const currentLabel = new Gtk.Label({ cssClasses: ["theme-toggle-current"] })
    currentThemeName.subscribe(slug => currentLabel.set_label(slug))
    currentLabel.set_label(currentThemeName.get())
    const arrowLabel = new Gtk.Label({ label: "›", cssClasses: ["theme-toggle-arrow"] })

    const inner = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 })
    inner.append(new Gtk.Label({ label: "Tema", cssClasses: ["theme-toggle-label"], hexpand: true, xalign: 0 }))
    inner.append(currentLabel)
    inner.append(arrowLabel)
    const toggleBtn = new Gtk.Button({ child: inner, cssClasses: ["theme-selector-toggle"], hexpand: true })

    // Panel
    const panel = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 10,
        cssClasses: ["theme-panel"],
        visible: false,
    })
    if (themes.length === 0) {
        panel.append(new Gtk.Label({ label: "No hay temas en ~/.config/shiro-theme/themes", cssClasses: ["theme-empty"] }))
    } else {
        const row = new Gtk.Box({ spacing: 8 })
        row.append(Preview(themes, selected))
        row.append(SidePanel(themes, selected, pendingMode))
        panel.append(row)
        panel.append(ApplyButton(themes, selected, pendingMode))
    }

    toggleBtn.connect("clicked", () => themeExpanded.set(!themeExpanded.get()))
    // La interfaz sigue a themeExpanded (el menú lo cierra al ocultarse)
    themeExpanded.subscribe(next => {
        panel.set_visible(next)
        if (next) {
            // Al abrir, empieza en el tema activo con su modo actual
            const idx = themes.findIndex(t => t.slug === currentThemeName.get())
            if (idx >= 0) selected.set(idx)
            pendingMode.set(wallpaperMode.get())
            toggleBtn.add_css_class("expanded")
            arrowLabel.set_label("⌄")
        } else {
            toggleBtn.remove_css_class("expanded")
            arrowLabel.set_label("›")
        }
    })

    const root = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, cssClasses: ["theme-selector"] })
    root.append(toggleBtn)
    root.append(panel)
    return root
}
