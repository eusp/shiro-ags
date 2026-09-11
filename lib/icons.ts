// Resolución de icono real de una app a partir de su .desktop, compartida
// entre la sidebar y el preview de apps de la topbar para que ambas
// muestren siempre el mismo icono (a color, no una variante "-symbolic"
// que los temas de iconos normales no traen por app).
import Gio from "gi://Gio?version=2.0"
import GioUnix from "gi://GioUnix"
import Apps from "./apps"

const apps = new Apps()

export function findAppMatch(match: string): { desktopApp: GioUnix.DesktopAppInfo | null, astalId?: string } {
    if (!match) return { desktopApp: null }

    const tryGetAppInfo = (id: string) => {
        if (!id) return null
        const { DesktopAppInfo } = GioUnix
        return DesktopAppInfo.new(id) ||
            DesktopAppInfo.new(id + ".desktop") ||
            DesktopAppInfo.new("org.mozilla." + id) ||
            DesktopAppInfo.new("org.gnome." + (id === "nautilus" ? "Nautilus" : id))
    }

    const astalApp = apps.list.find(a => {
        const id = (a.id || "").toLowerCase()
        const wm = (a.wm_class || "").toLowerCase()
        const name = (a.name || "").toLowerCase()
        return id.includes(match) || wm.includes(match) || name.includes(match)
    })

    let desktopApp: GioUnix.DesktopAppInfo | null = null

    if (astalApp?.id) {
        desktopApp = GioUnix.DesktopAppInfo.new(astalApp.id)
    }

    if (!desktopApp) desktopApp = tryGetAppInfo(match)

    if (!desktopApp) {
        const allApps = Gio.AppInfo.get_all()
        desktopApp = allApps.find(a =>
            (a.get_id() || "").toLowerCase().includes(match) ||
            (a.get_name() || "").toLowerCase().includes(match) ||
            (a.get_executable() || "").toLowerCase().includes(match)
        ) as GioUnix.DesktopAppInfo
    }

    return { desktopApp, astalId: astalApp?.id }
}

export function resolveAppIcon(wmClass: string): string {
    const { desktopApp } = findAppMatch((wmClass || "").toLowerCase())
    return desktopApp?.get_icon()?.to_string() || "application-x-executable"
}
