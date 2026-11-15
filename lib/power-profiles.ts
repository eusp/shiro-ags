// Perfiles de energía de power-profiles-daemon por D-Bus (lo mismo que hace
// powerprofilesctl). Cambiarlos no pide contraseña desde la sesión del usuario.
import GLib from "gi://GLib?version=2.0"
import Gio from "gi://Gio?version=2.0"

const BUS_NAME = "org.freedesktop.UPower.PowerProfiles"
const OBJECT_PATH = "/org/freedesktop/UPower/PowerProfiles"
const IFACE = "org.freedesktop.UPower.PowerProfiles"

export type Profile = "power-saver" | "balanced" | "performance"

export const PROFILE_LABEL: Record<string, string> = {
    "power-saver": "Ahorro de energía",
    "balanced": "Balanceado",
    "performance": "Rendimiento",
}

let proxy: any = null
const listeners: Array<() => void> = []

function getProxy() {
    if (proxy) return proxy
    try {
        proxy = Gio.DBusProxy.new_for_bus_sync(
            Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null,
            BUS_NAME, OBJECT_PATH, IFACE, null,
        )
        proxy.connect("g-properties-changed", () => listeners.forEach(fn => fn()))
    } catch (e) {
        logError(e as Error, "power-profiles: no se pudo conectar")
        proxy = null
    }
    return proxy
}

// null si el servicio no existe (por ejemplo en la PC sin power-profiles-daemon)
export function activeProfile(): Profile | null {
    const v = getProxy()?.get_cached_property("ActiveProfile")
    return v ? (v.deep_unpack() as Profile) : null
}

export function availableProfiles(): Profile[] {
    const v = getProxy()?.get_cached_property("Profiles")
    if (!v) return []
    return v.recursiveUnpack().map((p: any) => p.Profile as Profile)
}

export function setProfile(profile: Profile) {
    const p = getProxy()
    if (!p) return
    p.call(
        "org.freedesktop.DBus.Properties.Set",
        new GLib.Variant("(ssv)", [IFACE, "ActiveProfile", new GLib.Variant("s", profile)]),
        Gio.DBusCallFlags.NONE, -1, null,
        (_src: any, res: any) => {
            try { p.call_finish(res) } catch (e) { logError(e as Error, "power-profiles: no se pudo cambiar") }
        },
    )
}

// Ahorro → Balanceado → Rendimiento → Ahorro (solo los que existan)
export function cycleProfile() {
    const order: Profile[] = ["power-saver", "balanced", "performance"]
    const avail = availableProfiles()
    const list = order.filter(p => avail.includes(p))
    if (!list.length) return
    const cur = activeProfile()
    const next = list[(list.indexOf(cur as Profile) + 1) % list.length]
    setProfile(next)
}

export function onProfileChanged(fn: () => void) {
    getProxy()
    listeners.push(fn)
}
