import readline from "node:readline";

// clack's text inputs are backed by Node's readline. Readline natively maps Ctrl+←/→ and
// Alt+B / Alt+F to word movement, but NOT Alt+←/Alt+→ (meta+left/right) — which is the
// standard word-jump on macOS. This patches readline once so Alt+arrows move by word too.
//
// It relies on readline internals (_wordLeft/_wordRight/_ttyWrite). They've been stable for
// years, but if any ever disappears we feature-detect and no-op rather than crash. The patch
// only augments: anything that isn't Alt+left/right falls through to the original handler.
//
// Note: this only helps when the terminal actually delivers Alt+arrow as meta+left/right
// (e.g. macOS Terminal/iTerm with "Use Option as Meta key" enabled). Terminals that map
// Option to accented characters can't be fixed from here.

type KeyEvent = { name?: string; meta?: boolean; ctrl?: boolean; shift?: boolean } | undefined;

type ReadlineInternals = {
  _ttyWrite?: (this: ReadlineInternals, char: string | undefined, key: KeyEvent) => void;
  _wordLeft?: (this: ReadlineInternals) => void;
  _wordRight?: (this: ReadlineInternals) => void;
};

let patched = false;

export function enableWordNavigation() {
  if (patched) {
    return;
  }
  const proto = readline.Interface.prototype as unknown as ReadlineInternals;
  const original = proto._ttyWrite;
  if (
    typeof original !== "function" ||
    typeof proto._wordLeft !== "function" ||
    typeof proto._wordRight !== "function"
  ) {
    return;
  }
  patched = true;
  proto._ttyWrite = function (this: ReadlineInternals, char, key) {
    if (key?.meta && !key.ctrl && key.name === "left") {
      return this._wordLeft!();
    }
    if (key?.meta && !key.ctrl && key.name === "right") {
      return this._wordRight!();
    }
    return original.call(this, char, key);
  };
}
