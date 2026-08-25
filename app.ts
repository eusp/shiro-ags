import app from "ags/gtk4/app"
import { Gtk, Gdk } from "ags/gtk4"
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import style from "./style.scss"
import TopBar from "./widget/TopBar"
import SideBar from "./widget/SideBar"
import RightMenu from "./widget/RightMenu"
import Notes from "./widget/Notes"
import NotificationPopup from "./widget/Shared/NotificationPopup"

// ─── Bootstrap theme CSS vars on startup ─────────────────────────────────────
// The SCSS is compiled with the current theme at build time, but we also inject
// CSS custom properties so that ThemeSelector can hot-reload colors at runtime.

function loadStartupTheme() {
    const shiroDir = `${GLib.get_home_dir()}/.config/shiro-theme`

    try {
        const [okSlug, slugBytes] = GLib.file_get_contents(`${shiroDir}/current-theme`)
        if (!okSlug) return
        const slug = new TextDecoder().decode(slugBytes).trim()

        const [okTheme, themeBytes] = GLib.file_get_contents(`${shiroDir}/themes/${slug}.json`)
        if (!okTheme) return
        const t = JSON.parse(new TextDecoder().decode(themeBytes))

        const c = (hex: string) => {
            if (!hex || hex.length < 7) return "0, 0, 0"
            return `${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}`
        }

        const cssVars = `
* {
  --base: ${t.base}; --base-rgb: ${c(t.base)};
  --text: ${t.text}; --text-rgb: ${c(t.text)};
  --subtext0: ${t.subtext0}; --subtext0-rgb: ${c(t.subtext0)};
  --surface0: ${t.surface0}; --surface0-rgb: ${c(t.surface0)};
  --surface1: ${t.surface1}; --surface1-rgb: ${c(t.surface1)};
  --surface2: ${t.surface2}; --surface2-rgb: ${c(t.surface2)};
  --overlay0: ${t.overlay0}; --overlay0-rgb: ${c(t.overlay0)};
  --overlay1: ${t.overlay1}; --overlay1-rgb: ${c(t.overlay1)};
  --primary: ${t.primary}; --primary-rgb: ${c(t.primary)};
  --primary-alt: ${t.primaryAlt}; --primary-alt-rgb: ${c(t.primaryAlt)};
  --primary-muted: ${t.primaryMuted}; --primary-muted-rgb: ${c(t.primaryMuted)};
  --danger: ${t.danger}; --danger-rgb: ${c(t.danger)};
  --warning: ${t.warning}; --warning-rgb: ${c(t.warning)};
  --success: ${t.success}; --success-rgb: ${c(t.success)};
  --info: ${t.info}; --info-rgb: ${c(t.info)};
  --accent0: ${t.accent0}; --accent0-rgb: ${c(t.accent0)};
  --accent1: ${t.accent1}; --accent1-rgb: ${c(t.accent1)};
  --accent2: ${t.accent2}; --accent2-rgb: ${c(t.accent2)};
  --accent3: ${t.accent3}; --accent3-rgb: ${c(t.accent3)};
  --mantle: ${t.mantle}; --mantle-rgb: ${c(t.mantle)};
  --crust: ${t.crust}; --crust-rgb: ${c(t.crust)};
}
`
        const provider = new Gtk.CssProvider()
        try {
            provider.load_from_string(cssVars)
        } catch {
            const bytes = new TextEncoder().encode(cssVars)
            ;(provider as any).load_from_data(bytes, bytes.length)
        }

        const display = Gdk.Display.get_default()
        if (display) {
            Gtk.StyleContext.add_provider_for_display(
                display,
                provider,
                Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1,
            )
        }
    } catch (e) {
        console.warn("shiro-theme: could not load startup theme vars", e)
    }
}

app.start({
    css: style,
    main() {
        loadStartupTheme()
        const monitors = app.get_monitors()
        monitors.forEach((monitor) => {
            TopBar(monitor)
            SideBar(monitor)
            RightMenu(monitor)
            NotificationPopup(monitor)
        })

        if (monitors[0]) Notes(monitors[0])
    },
})
