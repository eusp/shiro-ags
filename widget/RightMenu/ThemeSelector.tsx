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
            // Apply GRUB theme with sudo (requires sudoers rule — see README)
            execAsync(["sudo", "-n", "node", `${SHIRO_DIR}/build-grub.js`]).catch(() => { })
        })
        .catch(() => { })
        .finally(() => isApplying.set(false))
}

const WALLPAPER_HEIGHT = 140
const CARD_WIDTH = 292  // 320 - 12px padding × 2 - borders

// ─── Wallpaper Thumbnail ──────────────────────────────────────────────────────

function WallpaperThumbnail(slug: string, baseColor: string): Gtk.Widget {
    const pngPath = `${SHIRO_DIR}/wallpapers/${slug}.png`

    if (GLib.file_test(pngPath, GLib.FileTest.EXISTS)) {
        // Attempt 1: scale to width → crop top → Picture fill (top-aligned)
        try {
            const scaled = GdkPixbuf.Pixbuf.new_from_file_at_scale(pngPath, CARD_WIDTH, -1, true)
            const cropH = Math.min(WALLPAPER_HEIGHT, scaled.get_height())
            const cropped = (scaled as any).new_subpixbuf(0, 0, CARD_WIDTH, cropH)
            const pic = Gtk.Picture.new_for_pixbuf(cropped)
            pic.set_content_fit(Gtk.ContentFit.FILL)
            pic.set_size_request(-1, WALLPAPER_HEIGHT)
            pic.set_hexpand(true)
            pic.add_css_class("theme-card-wallpaper")
            return pic
        } catch (e) {
            console.warn(`[Theme:${slug}] subpixbuf failed:`, e)
        }

        // Attempt 2: exact dimensions (slight vertical squeeze) via Picture
        try {
            const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(pngPath, CARD_WIDTH, WALLPAPER_HEIGHT, false)
            const pic = Gtk.Picture.new_for_pixbuf(pixbuf)
            pic.set_content_fit(Gtk.ContentFit.FILL)
            pic.set_size_request(-1, WALLPAPER_HEIGHT)
            pic.set_hexpand(true)
            pic.add_css_class("theme-card-wallpaper")
            return pic
        } catch (e) {
            console.warn(`[Theme:${slug}] scale failed:`, e)
        }

        // Attempt 3: Gtk.Picture directly (centered crop — always works)
        try {
            const pic = new Gtk.Picture()
            pic.set_filename(pngPath)
            pic.set_content_fit(Gtk.ContentFit.COVER)
            pic.set_size_request(-1, WALLPAPER_HEIGHT)
            pic.set_hexpand(true)
            pic.add_css_class("theme-card-wallpaper")
            return pic
        } catch { }
    }

    // Final fallback: solid base-color block
    const [r, g, b] = hexToRgbParts(baseColor)
    const area = new Gtk.DrawingArea()
    area.set_size_request(-1, WALLPAPER_HEIGHT)
    area.set_hexpand(true)
    area.add_css_class("theme-card-no-wallpaper")
    area.set_draw_func((_w, cr, w, h) => {
        cr.setSourceRGB(r / 255, g / 255, b / 255)
        cr.rectangle(0, 0, w, h)
        cr.fill()
    })
    return area
}

// ─── Wallpaper Mode Icon Button ─────────────────────────────────────────────
// Applies this card's theme with the given wallpaper mode (animated/static).
// These are the card's only clickable elements — the card itself is now a
// plain (non-interactive) box, not a button.

function WallpaperModeButton(
    iconName: string,
    tooltip: string,
    mode: WallpaperMode,
    slug: string,
    data: ThemeColors,
    activeSlug: ReturnType<typeof makeVar<string>>,
): Gtk.Button {
    const btn = new Gtk.Button({
        cssClasses: ["wallpaper-mode-icon-btn"],
        tooltipText: tooltip,
        child: new Gtk.Image({ iconName, pixelSize: 11 }),
    })

    const update = () => {
        const active = activeSlug.get() === slug && wallpaperMode.get() === mode
        if (active) btn.add_css_class("active")
        else btn.remove_css_class("active")
    }
    update()
    activeSlug.subscribe(update)
    wallpaperMode.subscribe(update)

    btn.connect("clicked", () => applyTheme(slug, data, mode))
    return btn
}

// ─── Theme Card ───────────────────────────────────────────────────────────────

function ThemeCard(slug: string, data: ThemeColors, activeSlug: ReturnType<typeof makeVar<string>>): Gtk.Widget {
    const wallpaper = WallpaperThumbnail(slug, data.base)

    const nameLabel = new Gtk.Label({ label: data.name || slug, xalign: 0, hexpand: true, cssClasses: ["theme-card-name"] })
    const activeBadge = new Gtk.Label({ label: "activo", cssClasses: ["theme-card-active-badge"], visible: false })

    const modeIcons = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 4, cssClasses: ["wallpaper-mode-icons"] })
    modeIcons.append(WallpaperModeButton("video-x-generic-symbolic", "Aplicar con fondo animado (.mp4)", "animated", slug, data, activeSlug))
    modeIcons.append(WallpaperModeButton("image-x-generic-symbolic", "Aplicar con fondo estático (.png)", "static", slug, data, activeSlug))

    const nameRow = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6,
        cssClasses: ["theme-card-info"],
        valign: Gtk.Align.END,
        hexpand: true,
    })
    nameRow.append(nameLabel)
    nameRow.append(activeBadge)
    nameRow.append(modeIcons)

    // Overlay name + mode buttons on top of the wallpaper image
    const card = new Gtk.Overlay({ cssClasses: ["theme-card"] })
    card.set_child(wallpaper)
    card.add_overlay(nameRow)

    const updateActive = () => {
        const active = activeSlug.get() === slug
        if (active) { card.add_css_class("active-theme"); activeBadge.set_visible(true) }
        else { card.remove_css_class("active-theme"); activeBadge.set_visible(false) }
    }
    updateActive()
    activeSlug.subscribe(updateActive)

    return card
}

// ─── Main Widget ──────────────────────────────────────────────────────────────

export default function ThemeSelector() {
    const themes = loadThemes()

    const currentLabel = new Gtk.Label({ cssClasses: ["theme-toggle-current"] })
    currentThemeName.subscribe(slug => currentLabel.set_label(slug))
    currentLabel.set_label(currentThemeName.get())

    const arrowLabel = new Gtk.Label({ label: "›", cssClasses: ["theme-toggle-arrow"] })

    const inner = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 })
    inner.append(new Gtk.Image({ iconName: "applications-graphics-symbolic" }))
    inner.append(new Gtk.Label({ label: "Tema", cssClasses: ["theme-toggle-label"], hexpand: true, xalign: 0 }))
    inner.append(currentLabel)
    inner.append(arrowLabel)

    const toggleBtn = new Gtk.Button({ child: inner, cssClasses: ["theme-selector-toggle"], hexpand: true })

    // Cards
    const cardsBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, cssClasses: ["theme-cards-container"], marginTop: 4 })
    themes.forEach(({ slug, data }) => cardsBox.append(ThemeCard(slug, data, currentThemeName)))

    const applyingLabel = new Gtk.Label({
        label: "⟳  aplicando en segundo plano...",
        cssClasses: ["applying-indicator"],
        visible: false,
        xalign: 0,
    })
    isApplying.subscribe(v => applyingLabel.set_visible(v))

    const scroll = new Gtk.ScrolledWindow({
        vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
        hscrollbarPolicy: Gtk.PolicyType.NEVER,
        maxContentHeight: 380,
        propagateNaturalHeight: true,
        child: cardsBox,
        visible: false,
    })

    toggleBtn.connect("clicked", () => {
        const next = !themeExpanded.get()
        themeExpanded.set(next)
        scroll.set_visible(next)
        if (next) {
            toggleBtn.add_css_class("expanded")
            arrowLabel.set_label("⌄")
        } else {
            toggleBtn.remove_css_class("expanded")
            arrowLabel.set_label("›")
        }
    })

    const root = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4, cssClasses: ["theme-selector"] })
    root.append(toggleBtn)
    root.append(scroll)
    root.append(applyingLabel)

    return root
}
