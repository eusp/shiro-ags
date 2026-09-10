// Types for GObject libraries that have no @girs package on npm.
//
// Astal 4 ships only its typelib (no .gir), so ts-for-gir can't generate it.
// This covers just what AGS and this config touch; enum values were read from
// the installed Astal-4.0.typelib.

declare module "gi://Astal?version=4.0" {
    import Gtk from "gi://Gtk?version=4.0"
    import Gdk from "gi://Gdk?version=4.0"

    namespace Astal {
        enum WindowAnchor {
            NONE = 1,
            TOP = 2,
            RIGHT = 4,
            LEFT = 8,
            BOTTOM = 16,
        }

        enum Exclusivity {
            NORMAL = 0,
            EXCLUSIVE = 1,
            IGNORE = 2,
        }

        enum Layer {
            BACKGROUND = 0,
            BOTTOM = 1,
            TOP = 2,
            OVERLAY = 3,
        }

        enum Keymode {
            NONE = 0,
            EXCLUSIVE = 1,
            ON_DEMAND = 2,
        }

        namespace Window {
            interface ConstructorProps extends Gtk.Window.ConstructorProps {
                namespace: string
                anchor: WindowAnchor
                exclusivity: Exclusivity
                layer: Layer
                keymode: Keymode
                gdkmonitor: Gdk.Monitor
                monitor: number
                margin: number
                margin_left: number
                marginLeft: number
                margin_right: number
                marginRight: number
            }
        }

        class Window extends Gtk.Window {
            constructor(properties?: Partial<Window.ConstructorProps>, ...args: any[])
            namespace: string
            anchor: WindowAnchor
            exclusivity: Exclusivity
            layer: Layer
            keymode: Keymode
            gdkmonitor: Gdk.Monitor
            monitor: number
            margin: number
            margin_left: number
            marginLeft: number
            margin_right: number
            marginRight: number
        }

        namespace Slider {
            interface ConstructorProps extends Gtk.Scale.ConstructorProps {
                value: number
                min: number
                max: number
                step: number
                page: number
            }
        }

        class Slider extends Gtk.Scale {
            constructor(properties?: Partial<Slider.ConstructorProps>, ...args: any[])
            value: number
            min: number
            max: number
            step: number
            page: number
        }
    }

    export default Astal
}

// Optional at runtime: AGS only patches these astal-libs modules if they are
// installed. This config doesn't use them.
declare module "gi://AstalApps" {
    const lib: any
    export default lib
}
declare module "gi://AstalBattery" {
    const lib: any
    export default lib
}
declare module "gi://AstalBluetooth" {
    const lib: any
    export default lib
}
declare module "gi://AstalHyprland" {
    const lib: any
    export default lib
}
declare module "gi://AstalMpris" {
    const lib: any
    export default lib
}
declare module "gi://AstalNetwork" {
    const lib: any
    export default lib
}
declare module "gi://AstalNotifd" {
    const lib: any
    export default lib
}
declare module "gi://AstalPowerProfiles" {
    const lib: any
    export default lib
}
declare module "gi://AstalTray" {
    const lib: any
    export default lib
}
declare module "gi://AstalWp" {
    const lib: any
    export default lib
}
