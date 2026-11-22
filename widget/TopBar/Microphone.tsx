import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import { execAsync } from "ags/process"
import Wp from "../../lib/wp"
import { MenuPopover } from "../Shared/MenuPopover"

const wp = Wp.get_default()

export default function Microphone() {
    const getHasMic = () => {
        const mic = wp?.defaultMicrophone
        return mic && mic.id !== 0
    }

    const getMic = () => wp?.defaultMicrophone

    const image = new Gtk.Image({ 
        iconName: "microphone-disabled-symbolic" 
    })

    const menubutton = new Gtk.MenuButton({
        child: image,
        sensitive: false,
        visible: false,
    })

    const adjustment = new Gtk.Adjustment({
        lower: 0,
        upper: 1,
        stepIncrement: 0.05,
        value: 0,
    })

    const slider = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        drawValue: false,
        hexpand: true,
        adjustment: adjustment,
    })
    slider.add_css_class("volume-slider")

    slider.connect("value-changed", () => {
        const mic = getMic()
        if (mic && Math.abs(mic.volume - adjustment.value) > 0.01) {
            mic.set_volume(adjustment.value)
        }
    })

    // Con el micrófono en uso el botón no se desactiva: GTK atenúa los botones
    // desactivados y el aviso en rojo casi no se veía.
    let live = false
    let lastId = 0
    const update = () => {
        const has = getHasMic()
        const mic = getMic()

        image.iconName = has || live ? "audio-input-microphone-symbolic" : "microphone-disabled-symbolic"
        menubutton.sensitive = !!has || live
        // Solo aparece mientras alguna app usa el micrófono
        menubutton.visible = live

        if (has && mic && Math.abs(adjustment.value - mic.volume) > 0.01) {
            adjustment.value = mic.volume
        }

        const currentId = mic?.id ?? 0
        if (currentId !== lastId) {
            lastId = currentId
            if (mic) {
                mic.connect("notify::volume", update)
                mic.connect("notify::mute", update)
            }
        }
    }

    // Micrófono en uso: se pinta de rojo y el tooltip dice qué app lo tiene.
    // Se ignoran las capturas de salidas (".monitor"), como la del visualizador.
    let checkingLive = false
    const updateLive = async () => {
        if (checkingLive) return
        checkingLive = true
        try {
            const [outs, srcs] = await Promise.all([
                execAsync(["pactl", "-f", "json", "list", "source-outputs"]),
                execAsync(["pactl", "-f", "json", "list", "sources", "short"]),
            ])
            const monitors = new Set(
                JSON.parse(srcs).filter((x: any) => x.name.endsWith(".monitor")).map((x: any) => x.index),
            )
            const apps = [...new Set<string>(
                JSON.parse(outs)
                    .filter((o: any) => !o.corked && !monitors.has(o.source))
                    .map((o: any) => o.properties?.["application.name"] ?? o.properties?.["media.name"] ?? "?"),
            )]
            live = apps.length > 0
            if (live) menubutton.add_css_class("mic-live")
            else menubutton.remove_css_class("mic-live")
            update()
            menubutton.tooltipText = apps.length ? `Micrófono en uso: ${apps.join(", ")}` : ""
        } catch {
            // pactl no disponible un momento (PipeWire reiniciando)
        } finally {
            checkingLive = false
        }
    }

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        update()
        updateLive()
        return GLib.SOURCE_CONTINUE
    })
    updateLive()

    update()

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 10,
    })
    box.append(slider)

    const popover = MenuPopover(menubutton, [
        { title: "Micrófono", customChild: box }
    ])
    menubutton.set_popover(popover)

    return menubutton
}