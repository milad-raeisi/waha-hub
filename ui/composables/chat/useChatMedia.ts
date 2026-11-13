import {onBeforeUnmount, onMounted, reactive, ref, type Ref} from 'vue'
import {useServerStore} from '../../stores/useServerStore'

/**
 * Downloads message media once per (server, session, message) and shares the blob URL
 * between components, so re-rendering or refetching messages never downloads twice.
 *
 * Flow: GET /api/{session}/chats/{chatId}/messages/{id}?downloadMedia=true -> media.url,
 * then fetch the file with the server API key (media URLs are protected by it as well).
 */

export type MediaStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface MediaEntry {
    status: MediaStatus
    url: string | null
    mimetype: string | null
    filename: string | null
    size: number | null
    error: string | null
    /** The message as returned with downloadMedia=true (includes "media") */
    fullMessage: any
}

interface InternalEntry extends MediaEntry {
    promise: Promise<MediaEntry> | null
}

const MAX_CONCURRENT = 3
const entries = new Map<string, InternalEntry>()
const queue: { run: () => Promise<void>, priority: boolean }[] = []
let active = 0

function cacheKey(serverId: string, sessionName: string, messageId: string): string {
    return `${serverId}|${sessionName}|${messageId}`
}

function pump() {
    while (active < MAX_CONCURRENT && queue.length > 0) {
        const index = queue.findIndex((task) => task.priority)
        const [task] = queue.splice(index >= 0 ? index : 0, 1)
        active++
        task.run().finally(() => {
            active--
            pump()
        })
    }
}

function schedule<T>(job: () => Promise<T>, priority: boolean): Promise<T> {
    return new Promise((resolve, reject) => {
        queue.push({
            priority: priority,
            run: () => job().then(resolve, reject),
        })
        pump()
    })
}

/**
 * WAHA builds media URLs from WAHA_BASE_URL, which is often left as http://localhost:3000.
 * Prefer the same path on the server the dashboard is connected to, then the URL as-is.
 */
export function mediaUrlCandidates(url: string, connectionUrl?: string): string[] {
    if (!url) {
        return []
    }
    if (url.startsWith('data:') || url.startsWith('blob:')) {
        return [url]
    }
    if (!connectionUrl) {
        return [url]
    }
    const base = connectionUrl.replace(/\/+$/, '')
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        // Relative URL - resolve against the server, not the dashboard
        return [`${base}/${url.replace(/^\/+/, '')}`]
    }
    let connection: URL
    try {
        connection = new URL(base)
    } catch {
        return [url]
    }
    if (parsed.origin === connection.origin) {
        return [url]
    }
    const filesIndex = parsed.pathname.indexOf('/api/files/')
    if (filesIndex < 0) {
        return [url]
    }
    const rewritten = `${base}${parsed.pathname.slice(filesIndex)}${parsed.search}`
    return [rewritten, url]
}

function chatIdFromMessageId(id: string): string {
    const parts = String(id || '').split('_')
    return parts.length >= 3 ? parts[1] : 'all'
}

function describeError(error: any): string {
    return error?.response?.data?.message || error?.message || String(error)
}

export function useChatMedia() {
    const store = useServerStore()

    function entryFor(serverId: string, sessionName: string, messageId: string): MediaEntry {
        const key = cacheKey(serverId, sessionName, messageId)
        let entry = entries.get(key)
        if (!entry) {
            entry = reactive({
                status: 'idle',
                url: null,
                mimetype: null,
                filename: null,
                size: null,
                error: null,
                fullMessage: null,
                promise: null,
            }) as InternalEntry
            entries.set(key, entry)
        }
        return entry
    }

    async function fetchBlob(serverId: string, url: string): Promise<Blob> {
        const connection = store.getServer(serverId)?.connection
        const headers: Record<string, string> = {}
        if (connection?.key && !url.startsWith('data:')) {
            headers['X-Api-Key'] = connection.key
        }
        let lastError: any = null
        for (const candidate of mediaUrlCandidates(url, connection?.url)) {
            try {
                const response = await fetch(candidate, {headers: headers})
                if (response.ok) {
                    return await response.blob()
                }
                lastError = new Error(`${response.status} ${response.statusText}`.trim())
            } catch (e) {
                lastError = e
            }
        }
        throw lastError || new Error('Failed to download media')
    }

    async function download(entry: InternalEntry, serverId: string, sessionName: string, message: any): Promise<MediaEntry> {
        try {
            let media = message?.media?.url ? message.media : null
            if (!media) {
                const fullMessage = await store.getChatMessage(serverId, sessionName, message.id, chatIdFromMessageId(message.id))
                entry.fullMessage = fullMessage
                media = fullMessage?.media
                if (!media?.url) {
                    // media.error is a serialized Error - "details" holds the stack, first line is "Name: message"
                    const error = media?.error
                    throw new Error(error?.message || error?.details?.split('\n')[0] || 'NO_URL')
                }
            }
            const blob = await fetchBlob(serverId, media.url)
            entry.url = URL.createObjectURL(blob)
            entry.mimetype = media.mimetype || blob.type || null
            entry.filename = media.filename || null
            entry.size = blob.size
            entry.status = 'ready'
        } catch (e) {
            console.warn('Failed to download media', message?.id, e)
            entry.error = describeError(e)
            entry.status = 'error'
        } finally {
            entry.promise = null
        }
        return entry
    }

    /**
     * Starts (or joins) the download. "priority" jumps the queue - used when the user clicks.
     */
    function load(serverId: string, sessionName: string, message: any, priority = false): Promise<MediaEntry> {
        const entry = entryFor(serverId, sessionName, message.id) as InternalEntry
        if (entry.status === 'ready') {
            return Promise.resolve(entry)
        }
        if (entry.promise) {
            return entry.promise
        }
        entry.status = 'loading'
        entry.error = null
        entry.promise = schedule(() => download(entry, serverId, sessionName, message), priority)
        return entry.promise
    }

    function save(entry: MediaEntry, fallbackName: string) {
        if (!entry.url) {
            return
        }
        let name = entry.filename || ''
        if (!name) {
            const ext = (entry.mimetype || '').split('/')[1]?.split(';')[0]?.replace('jpeg', 'jpg') || 'bin'
            name = `${fallbackName}.${ext}`
        }
        const link = document.createElement('a')
        link.href = entry.url
        link.download = name
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    }

    return {entryFor, load, save}
}

/**
 * Frees blob URLs of a session (or everything) - called when the chat dialog closes.
 */
export function releaseChatMedia(serverId?: string, sessionName?: string) {
    const prefix = serverId ? `${serverId}|${sessionName ?? ''}${sessionName ? '|' : ''}` : ''
    for (const [key, entry] of entries) {
        if (prefix && !key.startsWith(prefix)) {
            continue
        }
        if (entry.status === 'loading') {
            continue
        }
        if (entry.url?.startsWith('blob:')) {
            URL.revokeObjectURL(entry.url)
        }
        entries.delete(key)
    }
}

/**
 * Becomes true once the element gets close to the visible area of the chat.
 */
export function useNearViewport(target: Ref<HTMLElement | null>, rootMargin = '300px') {
    const visible = ref(false)
    let observer: IntersectionObserver | null = null
    onMounted(() => {
        if (!target.value || typeof IntersectionObserver === 'undefined') {
            visible.value = true
            return
        }
        observer = new IntersectionObserver((records) => {
            if (records.some((record) => record.isIntersecting)) {
                visible.value = true
                observer?.disconnect()
                observer = null
            }
        }, {rootMargin})
        observer.observe(target.value)
    })
    onBeforeUnmount(() => {
        observer?.disconnect()
        observer = null
    })
    return visible
}
