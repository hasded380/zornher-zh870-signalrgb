# ZORNHER ZH870 — SignalRGB Plugin

Per-key RGB for the **ZORNHER ZH870** in [SignalRGB](https://signalrgb.com/). Works over **USB only** — the 2.4G dongle is recognized but lighting is disabled.

**USB IDs:** `0x05AC` / `0x024F` · **104 keys** · **17×6** layout · **~21 FPS** actual refresh rate in SignalRGB

---

## Installation

1. Close SignalRGB.
2. Copy `ZORNHER_ZH870_Keyboard_Controller.js` to:

   ```
   %USERPROFILE%\Documents\WhirlwindFX\Plugins\ZORNHER_ZH870\ZORNHER_ZH870_Keyboard_Controller.js
   ```

3. Start SignalRGB and connect the keyboard via **USB**. Device name: **ZORNHER ZH870 USB**.

---

## Settings

| Parameter | Description |
|-----------|-------------|
| Lighting Mode | `Canvas` — effect colors; `Forced` — solid color |
| Forced Color | Color when mode is Forced |
| Shutdown Color | Applied when SignalRGB closes (black on system suspend) |

Close the OEM driver `DeviceDriver.exe` if it conflicts with SignalRGB.

---

## How it works

On each frame the plugin samples colors from the canvas (or a forced/shutdown color), packs **104 LEDs** as `[id, R, G, B]` into a **416-byte** compact payload, and sends it in **7 HID chunks** over the vendor endpoint (`usage_page 0xFF13`, interface 2).

Protocol per frame: start command → ACK → data chunks → commit → ACK. Small delays between steps keep the firmware stable. Unchanged frames are skipped.

If LEDs glitch (especially F1–F12), increase `afterStartCmd` / `afterStartAck` in `timing` inside the `.js` file.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Device missing | Check plugin path, file name, USB cable |
| RGB endpoint missing | Replug keyboard; close `DeviceDriver.exe` |
| No lighting on 2.4G | Use USB — wireless is not supported |
| Unsupported device name | USB product must contain `ZH870` and `GAMING` |

---

## Uninstall

Delete `C:\Users\User\Documents\WhirlwindFX\Plugins\ZORNHER_ZH870\` and restart SignalRGB.

---

Unofficial community plugin — not affiliated with ZORNHER or WhirlwindFX.
