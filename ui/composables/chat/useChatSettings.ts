import {ref, type Ref} from 'vue'

/**
 * Per-browser chat preferences (localStorage), shared by all chat components.
 */

function readFlag(key: string, fallback: boolean): boolean {
    try {
        const value = localStorage.getItem(key)
        return value === null ? fallback : value === 'true'
    } catch {
        return fallback
    }
}

function persistedFlag(key: string, fallback: boolean): [Ref<boolean>, (value: boolean) => void] {
    const flag = ref(readFlag(key, fallback))
    const set = (value: boolean) => {
        flag.value = value
        try {
            localStorage.setItem(key, String(value))
        } catch {
            // storage disabled - keep the in-memory value
        }
    }
    return [flag, set]
}

/**
 * Hidden reading: never send read receipts (blue ticks) from the dashboard.
 * Loading messages and media through the API does not mark them as read -
 * the only receipt the chat UI could send is "mark chat as read" before replying.
 */
export const [hiddenReading, setHiddenReading] = persistedFlag('waha.chat.hiddenReading', true)

/** Auto-download photos, stickers and GIFs when they scroll into view */
export const [autoDownloadMedia, setAutoDownloadMedia] = persistedFlag('waha.chat.autoDownloadMedia', true)
