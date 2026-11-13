/**
 * PrimeVue dialogs close on Escape through a document-level listener, so one Escape press
 * closes every open dialog at once - including the chat behind a full-screen photo.
 *
 * This guard makes Escape close only the top-most layer:
 *  - an open image preview (profile picture, photo message) closes by itself, dialogs stay open;
 *  - with several dialogs stacked (chat -> contacts -> details), only the top one closes.
 */

let installed = false
let stopNext = false

function zIndexOf(element: Element): number {
    return Number(getComputedStyle(element).zIndex) || 0
}

function onCapture(event: KeyboardEvent) {
    stopNext = false
    if (event.key !== 'Escape') return
    // The image preview handles Escape itself (its mask is focused)
    if (document.querySelector('.p-image-mask')) {
        stopNext = true
        return
    }
    const masks = [...document.querySelectorAll('.p-dialog-mask')]
    if (masks.length < 2) return
    const top = masks.reduce((a, b) => (zIndexOf(b) >= zIndexOf(a) ? b : a))
    const close = top.querySelector<HTMLElement>('.p-dialog-header-close')
    if (close) {
        stopNext = true
        close.click()
    }
}

function onBubble(event: KeyboardEvent) {
    // Runs on <body>, before the dialogs' listeners on document
    if (event.key === 'Escape' && stopNext) {
        event.stopPropagation()
    }
    stopNext = false
}

export function useEscapeGuard() {
    if (installed || typeof window === 'undefined') return
    installed = true
    window.addEventListener('keydown', onCapture, true)
    document.body.addEventListener('keydown', onBubble)
}
