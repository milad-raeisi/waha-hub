import {CENTER_KINDS, messageKey, parseMessage, type ParsedMessage} from './messageParser'

export interface ReactionGroup {
    emoji: string
    count: number
    senders: string[]
    mine: boolean
}

export interface TimelineMessage {
    type: 'message'
    id: string
    key: string
    message: any
    parsed: ParsedMessage
    senderId: string
    reactions: ReactionGroup[]
    revoked: boolean
    /** Latest text after "edit" messages (NOWEB/GOWS keep edits as separate messages) */
    editedText: string | null
    centered: boolean
    firstInGroup: boolean
    lastInGroup: boolean
}

export interface TimelineDate {
    type: 'date'
    id: string
    timestamp: number
}

export type TimelineItem = TimelineMessage | TimelineDate

const GROUP_GAP_MS = 5 * 60 * 1000

const parsedCache = new WeakMap<object, ParsedMessage>()

export function parseCached(message: any): ParsedMessage {
    if (!message || typeof message !== 'object') {
        return parseMessage(message)
    }
    let parsed = parsedCache.get(message)
    if (!parsed) {
        parsed = parseMessage(message)
        parsedCache.set(message, parsed)
    }
    return parsed
}

export function timestampMs(value: any): number {
    const number = Number(value)
    if (!Number.isFinite(number) || number <= 0) {
        return 0
    }
    return number < 1e12 ? number * 1000 : number
}

export function senderOf(message: any): string {
    if (message?.fromMe) {
        return 'me'
    }
    return message?.participant || message?.author || message?.from || ''
}

function dayKey(ms: number): string {
    const date = new Date(ms)
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/**
 * Turns the raw (oldest -> newest) message list into what the chat renders:
 * applies reactions / edits / deletes to their target messages, drops technical messages,
 * inserts day separators and marks consecutive messages of the same sender.
 */
export function buildTimeline(messages: any[]): TimelineItem[] {
    const entries = (messages || []).map((message) => ({
        message: message,
        parsed: parseCached(message),
        key: messageKey(message?.id),
        ts: timestampMs(message?.timestamp),
    }))
    const byKey = new Map<string, (typeof entries)[number]>()
    for (const entry of entries) {
        if (entry.key) {
            byKey.set(entry.key, entry)
        }
    }

    const reactions = new Map<string, Map<string, { emoji: string, ts: number, fromMe: boolean }>>()
    const edits = new Map<string, { text: string, ts: number }>()
    const revoked = new Set<string>()
    const skip = new Set<object>()

    for (const entry of entries) {
        const parsed = entry.parsed
        if (parsed.kind === 'reaction' && parsed.reaction) {
            skip.add(entry)
            const target = parsed.reaction.targetKey
            const bySender = reactions.get(target) || new Map()
            const sender = senderOf(entry.message)
            const previous = bySender.get(sender)
            if (!previous || previous.ts <= entry.ts) {
                bySender.set(sender, {emoji: parsed.reaction.emoji, ts: entry.ts, fromMe: !!entry.message.fromMe})
            }
            reactions.set(target, bySender)
        } else if (parsed.kind === 'edit' && parsed.edit) {
            skip.add(entry)
            const previous = edits.get(parsed.edit.targetKey)
            if (parsed.edit.text && (!previous || previous.ts <= entry.ts)) {
                edits.set(parsed.edit.targetKey, {text: parsed.edit.text, ts: entry.ts})
            }
        } else if (parsed.kind === 'revoked' && parsed.revokeTarget && parsed.revokeTarget !== entry.key && byKey.has(parsed.revokeTarget)) {
            // The original message is loaded - show it as deleted, drop the technical "revoke" message
            skip.add(entry)
            revoked.add(parsed.revokeTarget)
        } else if (parsed.kind === 'hidden') {
            skip.add(entry)
        }
    }

    const items: TimelineItem[] = []
    let previous: TimelineMessage | null = null
    let previousTs = 0
    let previousDay = ''
    for (const entry of entries) {
        if (skip.has(entry)) {
            continue
        }
        const day = entry.ts ? dayKey(entry.ts) : previousDay
        if (day && day !== previousDay) {
            items.push({type: 'date', id: `date-${day}`, timestamp: entry.ts})
            previousDay = day
            previous = null
        }
        const senderId = senderOf(entry.message)
        const centered = CENTER_KINDS.includes(entry.parsed.kind)
        const firstInGroup = !previous
            || centered
            || previous.centered
            || previous.senderId !== senderId
            || entry.ts - previousTs > GROUP_GAP_MS
        if (previous && !firstInGroup) {
            previous.lastInGroup = false
        }

        const reactionGroups: ReactionGroup[] = []
        const bySender = entry.key ? reactions.get(entry.key) : undefined
        if (bySender) {
            const byEmoji = new Map<string, ReactionGroup>()
            for (const [sender, reaction] of bySender) {
                if (!reaction.emoji) {
                    continue
                }
                const group = byEmoji.get(reaction.emoji) || {emoji: reaction.emoji, count: 0, senders: [], mine: false}
                group.count++
                group.senders.push(sender)
                group.mine = group.mine || reaction.fromMe
                byEmoji.set(reaction.emoji, group)
            }
            reactionGroups.push(...[...byEmoji.values()].sort((a, b) => b.count - a.count))
        }

        const item: TimelineMessage = {
            type: 'message',
            id: entry.message.id,
            key: entry.key,
            message: entry.message,
            parsed: entry.parsed,
            senderId: senderId,
            reactions: reactionGroups,
            revoked: revoked.has(entry.key),
            editedText: edits.get(entry.key)?.text ?? null,
            centered: centered,
            firstInGroup: firstInGroup,
            lastInGroup: true,
        }
        items.push(item)
        previous = item
        previousTs = entry.ts
    }
    return items
}
