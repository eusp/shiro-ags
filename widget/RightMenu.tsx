import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import ClockWeather from "./RightMenu/ClockWeather"
import { QuickSettingsList } from "./RightMenu/QuickSettings"
import AppsPanel from "./RightMenu/AppsPanel"
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
                orientation={Gtk.Orientation.VERTICAL}
                cssClasses={["rightmenu-container"]}
                spacing={12}
                widthRequest={320}
            >
                {/* Clock siempre visible */}
                <box orientation={Gtk.Orientation.VERTICAL} cssClasses={["quick-settings"]} spacing={16}>
                    <ClockWeather />
                    {settingsList}
                </box>

                <ThemeSelector />

                {/* Apps + Power */}
                <box
                    orientation={Gtk.Orientation.VERTICAL}
                    cssClasses={["menu-bottom-zone"]}
                    spacing={0}
                    vexpand={true}
                    valign={Gtk.Align.END}
                >
                    <box orientation={Gtk.Orientation.VERTICAL} cssClasses={["apps-panel-zone"]}>
                        {appsPanel}
                    </box>
                    <box
                        orientation={Gtk.Orientation.HORIZONTAL}
                        cssClasses={["power-actions-zone"]}
                        hexpand={true}
                        halign={Gtk.Align.END}
                    >
                        <PowerActions />
                    </box>
                </box>
            </box>
        </Astal.Window>
    ) as Astal.Window

    rightMenuWindowRef = rightMenuWindow
    return rightMenuWindow
}
