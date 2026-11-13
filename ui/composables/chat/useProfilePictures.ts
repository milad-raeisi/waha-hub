import {reactive} from 'vue'
import {useServerStore} from '../../stores/useServerStore'

/**
 * Profile pictures (GET /api/contacts/profile-picture), loaded once per (server, session, id)
 * and shared by every avatar. A small queue keeps long contact lists from flooding the server.
 */

export interface PictureEntry {
    status: 'idle' | 'loading' | 'ready' | 'none' | 'error'
    url: string | null
}

const MAX_CONCURRENT = 4
const entries = new Map<string, PictureEntry>()
const queue: (() => Promise<void>)[] = []
let active = 0

function cacheKey(serverId: string, sessionName: string, id: string): string {
    return `${serverId}|${sessionName}|${id}`
}

function pump() {
    while (active < MAX_CONCURRENT && queue.length > 0) {
        // Newest first: what the user scrolled to most recently is what is on screen
        const job = queue.pop()!
        active++
        job().finally(() => {
            active--
            pump()
        })
    }
}

export function useProfilePictures() {
    const store = useServerStore()

    function entryFor(serverId: string, sessionName: string, id: string): PictureEntry {
        const key = cacheKey(serverId, sessionName, id)
        let entry = entries.get(key)
        if (!entry) {
            entry = reactive({status: 'idle', url: null}) as PictureEntry
            entries.set(key, entry)
        }
        return entry
    }

    function load(serverId: string, sessionName: string, id: string) {
        if (!serverId || !sessionName || !id) return
        const entry = entryFor(serverId, sessionName, id)
        if (entry.status !== 'idle') return
        entry.status = 'loading'
        queue.push(async () => {
            try {
                const result: any = await store.getProfilePicture(serverId, sessionName, id)
                const url = typeof result === 'string' ? result : result?.profilePictureURL
                entry.url = url || null
                entry.status = url ? 'ready' : 'none'
            } catch (e) {
                entry.status = 'error'
            }
        })
        pump()
    }

    return {entryFor, load}
}

/** Forget cached pictures of a session (URLs from WhatsApp expire) */
export function releaseProfilePictures(serverId?: string, sessionName?: string) {
    const prefix = serverId ? `${serverId}|${sessionName ?? ''}${sessionName ? '|' : ''}` : ''
    for (const [key, entry] of entries) {
        if ((!prefix || key.startsWith(prefix)) && entry.status !== 'loading') {
            entries.delete(key)
        }
    }
}
