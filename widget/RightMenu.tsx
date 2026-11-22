import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import Clock from "./RightMenu/Clock"
import { QuickSettingsList } from "./RightMenu/QuickSettings"
import AppsPanel, { appsExpanded } from "./RightMenu/AppsPanel"
import PowerActions from "./RightMenu/PowerActions"
import ThemeSelector, { themeExpanded } from "./RightMenu/ThemeSelector"
import { perfExpanded } from "./RightMenu/PerformancePanel"

declare const imports: any
const { GLib } = imports.gi

// Ancho fijo del menú (antes lo marcaba la fila de fecha + clima)
const MENU_WIDTH = 398

let rightMenuWindowRef: Astal.Window | null = null
let appsPanelRef: any = null

export function toggleRightMenu() {
    if (!rightMenuWindowRef) return
    if (rightMenuWindowRef.visible) {
        rightMenuWindowRef.hide()
    } else {
        rightMenuWindowRef.show()
    }
}

export default function RightMenu(gdkmonitor: Gdk.Monitor) {
    const { TOP, BOTTOM, RIGHT } = Astal.WindowAnchor

    const appsPanel = <AppsPanel />
    appsPanelRef = appsPanel

    const settingsList = (
        <box orientation={Gtk.Orientation.VERTICAL} cssClasses={["quick-settings-zone"]}>
            <QuickSettingsList />
        </box>
    ) as Gtk.Box

    const topZone = (
        <box orientation={Gtk.Orientation.VERTICAL} cssClasses={["quick-settings"]} spacing={16}>
            <Clock />
            {settingsList}
        </box>
    ) as Gtk.Box
    const themeSelector = <ThemeSelector /> as Gtk.Widget
    themeSelector.marginBottom = 12
    const appsPanelZone = (
        <box orientation={Gtk.Orientation.VERTICAL} cssClasses={["apps-panel-zone"]}>
            {appsPanel}
        </box>
    ) as Gtk.Box

    const bottomZone = (
        <box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={["menu-bottom-zone"]}
            spacing={0}
            vexpand={true}
            valign={Gtk.Align.END}
        >
            {themeSelector}
            {appsPanelZone}
            <box
                orientation={Gtk.Orientation.HORIZONTAL}
                cssClasses={["power-actions-zone"]}
                hexpand={true}
                halign={Gtk.Align.END}
            >
                <PowerActions />
            </box>
        </box>
    ) as Gtk.Box

    let container: Gtk.Box | null = null

    // Apps expandidas: ocupan todo el RightMenu, lo de arriba se oculta
    appsExpanded.subscribe(expanded => {
        // Ancho fijo siempre, para que no se estreche al ocultar lo de arriba
        container?.set_size_request(MENU_WIDTH, -1)
        topZone.set_visible(!expanded)
        themeSelector.set_visible(!expanded)
        appsPanelZone.vexpand = expanded
        bottomZone.valign = expanded ? Gtk.Align.FILL : Gtk.Align.END
    })

    // Detalles de rendimiento abiertos: se ocultan temas y apps para darles espacio
    perfExpanded.subscribe(expanded => {
        themeSelector.set_visible(!expanded && !appsExpanded.get())
        appsPanelZone.set_visible(!expanded)
    })

    // Hide only the toggles list when theme selector is open
    themeExpanded.subscribe(expanded => {
        settingsList.set_visible(!expanded)
    })

    const rightMenuWindow = (
        <Astal.Window
            name="rightmenu"
            cssClasses={["RightMenu"]}
            visible={false}
            gdkmonitor={gdkmonitor}
            exclusivity={Astal.Exclusivity.EXCLUSIVE}
            anchor={TOP | BOTTOM | RIGHT}
            application={app}
            layer={Astal.Layer.TOP}
            keymode={Astal.Keymode.ON_DEMAND}
            onHide={() => {
                // La próxima vez se abre limpio: apps, tema y rendimiento recogidos
                appsExpanded.set(false)
                themeExpanded.set(false)
                perfExpanded.set(false)
            }}
            onShow={() => {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    if (appsPanelRef && appsPanelRef.searchEntry) {
                        appsPanelRef.searchEntry.grab_focus()
                    }
                    return false
                })
            }}
        >
            <box
                $={self => container = self}
                orientation={Gtk.Orientation.VERTICAL}
                cssClasses={["rightmenu-container"]}
                spacing={12}
                widthRequest={MENU_WIDTH}
            >
                {/* Clock siempre visible */}
                {topZone}

                {/* Tema + Apps + Power */}
                {bottomZone}
            </box>
        </Astal.Window>
    ) as Astal.Window

    rightMenuWindowRef = rightMenuWindow
    return rightMenuWindow
}
