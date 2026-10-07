// A window on the server PC (or a plain browser tab) can act as one cashier terminal:
//  - ?terminal=PC-02 in the address: the extra window Admin Station's "Open window" button opens, or a browser tab;
//  - the "I am a cashier" choice on the sign-in screen, remembered for this window only (sessionStorage).
// Real cashier PCs get their terminal from the Electron settings instead and ignore both.

const KEY = 'pos9010-acting-terminal'
const VALID = /^PC-\d{2}$/

export function actingTerminalId(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get('terminal')
  if (fromUrl && VALID.test(fromUrl) && fromUrl !== 'PC-00') return fromUrl
  try {
    const chosen = sessionStorage.getItem(KEY)
    return chosen && VALID.test(chosen) ? chosen : null
  } catch {
    return null
  }
}

/** Switches this window to a terminal (or back to the owner sign-in with null). Reloads so every screen starts clean. */
export function setActingTerminal(terminalId: string | null): void {
  try {
    if (terminalId) sessionStorage.setItem(KEY, terminalId)
    else sessionStorage.removeItem(KEY)
  } catch { /* storage blocked: the URL parameter still works */ }
  if (!terminalId && new URLSearchParams(window.location.search).has('terminal')) {
    window.location.search = ''
    return
  }
  window.location.reload()
}
