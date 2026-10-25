import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import ClockWeather from "./RightMenu/ClockWeather"
import { QuickSettingsList } from "./RightMenu/QuickSettings"
import AppsPanel, { appsExpanded } from "./RightMenu/AppsPanel"
import PowerActions from "./RightMenu/PowerActions"
import ThemeSelector, { themeExpanded } from "./RightMenu/ThemeSelector"

declare const imports: any
const { GLib } = imports.gi

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
            <ClockWeather />
            {settingsList}
        </box>
    ) as Gtk.Box
    const themeSelector = <ThemeSelector /> as Gtk.Widget
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
        // Se fija el ancho actual para que la barra no se estreche al ocultar lo de arriba
        if (expanded && container) container.set_size_request(container.get_width(), -1)
        else if (container) container.set_size_request(320, -1)
        topZone.set_visible(!expanded)
        themeSelector.set_visible(!expanded)
        appsPanelZone.vexpand = expanded
        bottomZone.valign = expanded ? Gtk.Align.FILL : Gtk.Align.END
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
                widthRequest={320}
            >
                {/* Clock siempre visible */}
                {topZone}

                {themeSelector}

                {/* Apps + Power */}
                {bottomZone}
            </box>
        </Astal.Window>
    ) as Astal.Window

    rightMenuWindowRef = rightMenuWindow
    return rightMenuWindow
}
