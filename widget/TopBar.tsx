import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"

import Workspaces from "./TopBar/Workspaces"
import Clock from "./TopBar/Clock"
import Clipboard from "./TopBar/Clipboard"
import SystemMonitor from "./TopBar/SystemMonitor"
import Volume from "./TopBar/Volume"
import Microphone from "./TopBar/Microphone"
import BluetoothIndicator from "./TopBar/Bluetooth"
import NetworkIndicator from "./TopBar/Network"
import BatteryIndicator from "./TopBar/Battery"
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
      <box cssClasses={["bar-content"]}>
        {/* LEFT — Workspaces */}
        <box cssClasses={["bar-left"]} halign={Gtk.Align.START} hexpand spacing={8}>
          <Workspaces />
        </box>

        {/* CENTER — Clock */}
        <box cssClasses={["bar-center"]} halign={Gtk.Align.CENTER} hexpand>
          <Clock />
        </box>

        {/* RIGHT — System icons */}
        <box cssClasses={['bar-right']} halign={Gtk.Align.END} hexpand spacing={6}>
          <RightMenuToggle />
          <KeyboardLayout />
          <Clipboard />
          <SystemMonitor />
          <Volume />
          <Microphone />
          <BluetoothIndicator />
          <NetworkIndicator />
          <SysTray />
          <BatteryIndicator />
        </box>
      </box>
    </Astal.Window>
  )
}