import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"

import Workspaces from "./TopBar/Workspaces"
import Clock from "./TopBar/Clock"
import Clipboard from "./TopBar/Clipboard"
import Volume from "./TopBar/Volume"
import Microphone from "./TopBar/Microphone"
import BluetoothIndicator from "./TopBar/Bluetooth"
import NetworkIndicator from "./TopBar/Network"
import BatteryIndicator from "./TopBar/Battery"
import UpsIndicator from "./TopBar/Ups"
import SysTray from "./TopBar/SysTray"
import RightMenuToggle from "./TopBar/RightMenuToggle"
import KeyboardLayout from "./TopBar/KeyboardLayout"

export default function TopBar(gdkmonitor: Gdk.Monitor) {
  const { TOP, LEFT, RIGHT } = Astal.WindowAnchor

  return (
    <Astal.Window
      name="topbar"
      cssClasses={["TopBar"]}
      visible
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.EXCLUSIVE}
      anchor={TOP | LEFT | RIGHT}
      application={app}
      layer={Astal.Layer.TOP}
    >
      {(() => {
        // CenterBox: el reloj queda en el centro exacto de la pantalla aunque
        // los lados cambien de ancho (íconos que aparecen y desaparecen). Con
        // una box de tres hexpand se corría hacia el lado con menos íconos.
        const bar = new Gtk.CenterBox({ cssClasses: ["bar-content"] })
        bar.set_start_widget(
          <box cssClasses={["bar-left"]} halign={Gtk.Align.START} spacing={8}>
            <Workspaces />
          </box> as Gtk.Widget
        )
        bar.set_center_widget(
          <box cssClasses={["bar-center"]}>
            <Clock />
          </box> as Gtk.Widget
        )
        bar.set_end_widget(
          <box cssClasses={['bar-right']} halign={Gtk.Align.END} spacing={6}>
            <RightMenuToggle />
            <KeyboardLayout />
            <Clipboard />
            <Volume />
            <Microphone />
            <BluetoothIndicator />
            <NetworkIndicator />
            <SysTray />
            <BatteryIndicator />
            <UpsIndicator />
          </box> as Gtk.Widget
        )
        return bar
      })()}
    </Astal.Window>
  )
}