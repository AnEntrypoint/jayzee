## Inputs (full)

```ts
Keys (case-insensitive): a letter ("e"), a digit ("1" = the number row), a name (space, shift, ctrl, alt, enter, escape, backspace, delete, f1-f12, up/down/left/right), or any KeyboardEvent.code (KeyE, Digit1, Numpad0, ArrowUp). Tab is reserved. Gamepad triggers as analog axes: Gamepad:LT/RT (0 to 1).
InputAxisDef = { keys?: str, mouse?: "deltaX" | "deltaY" | "wheelY" | "wheelX", gamepad?: "leftStickX" | "leftStickY" | "rightStickX" | "rightStickY" | "Gamepad:LT" | "Gamepad:RT" | "Gamepad:Axis<N>", deadzone?: 0-1 }
InputActionDef = { keys?: [key, ...], mouse?: "left" | "right" | "middle" | "mouse4" | "mouse5" | "wheelUp" | "wheelDown", gamepad?: "a" | "b" | "x" | "y" | "lb" | "rb" | "lt" | "rt" | "start" | "select" | "l3" | "r3" | "dpadUp/Down/Left/Right" | "Gamepad:Button<n>", modifiers?: [str, ...], activeOn?: "keydown" | "hold" | "keyup", touch?: { button?: bool, label?: str, slot?: 1 | 2 | 3 | 4, gesture?: "tap" | "double-tap" | "hold" | "press" }, active?: "scripts/file.js" }
Gamepads: a binding reads every connected controller as one; ui.js reads each controller apart with navigator.getGamepads(), a behavior script has none.
```
