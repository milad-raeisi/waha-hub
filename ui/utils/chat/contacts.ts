/**
 * Contacts and group members: normalization across engines (WEBJS / NOWEB / GOWS),
 * paged loading and export (CSV for Excel, vCard for phones / Google Contacts, JSON).
 */

export interface ContactRow {
    id: string
    /** Digits only, '' when unknown (hidden @lid contacts) */
    phone: string
    lid: string
    name: string
    pushName: string
    businessName: string
    displayName: string
    saved: boolean
    business: boolean
    blocked: boolean
    isMe: boolean
}

export interface GroupRow {
    id: string
    name: string
    size: number | null
}

export type ParticipantRole = 'superadmin' | 'admin' | 'participant' | 'left' | string

export interface MemberGroup {
    id: string
    name: string
    role: ParticipantRole
}

export interface MemberRow {
    key: string
    id: string
    phone: string
    lid: string
    displayName: string
    role: ParticipantRole
    groups: MemberGroup[]
}

//
// Ids
//

function jidOf(value: any): string {
    if (!value) return ''
    if (typeof value === 'string') return value
    return value._serialized || value.id || value.JID || value.user && value.server && `${value.user}@${value.server}` || ''
}

export function jidUser(jid: string): string {
    return String(jid || '').split('@')[0].split(':')[0]
}

export function isLid(jid: string): boolean {
    return String(jid || '').endsWith('@lid')
}

/** "972501234567@c.us" / "972501234567@s.whatsapp.net" -> "972501234567" */
export function phoneOf(jid: any): string {
    const value = jidOf(jid)
    if (!value) return ''
    if (!value.includes('@')) {
        const digits = value.replace(/\D/g, '')
        return digits.length >= 5 ? digits : ''
    }
    if (value.endsWith('@c.us') || value.endsWith('@s.whatsapp.net')) {
        return jidUser(value).replace(/\D/g, '')
    }
    return ''
}

export function formatPhone(phone: string): string {
    return phone ? `+${phone}` : ''
}

function first(raw: any, ...keys: string[]): string {
    for (const key of keys) {
        const value = raw?.[key]
        if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return ''
}

//
// Normalization
//

const NOT_CONTACTS = ['@g.us', '@broadcast', '@newsletter', '@call']

export function normalizeContact(raw: any): ContactRow | null {
    const id = jidOf(raw?.id) || first(raw, 'JID', 'jid')
    if (!id || NOT_CONTACTS.some((suffix) => id.endsWith(suffix)) || raw?.isGroup) {
        return null
    }
    const name = first(raw, 'name', 'FullName', 'fullName', 'FirstName', 'firstName', 'shortName')
    const pushName = first(raw, 'pushname', 'pushName', 'PushName', 'notify')
    const businessName = first(raw, 'verifiedName', 'BusinessName', 'businessName', 'verifiedBizName')
    const phone = phoneOf(id) || phoneOf(raw?.number) || phoneOf(raw?.pn) || phoneOf(raw?.phoneNumber) || phoneOf(raw?.PhoneNumber)
    return {
        id: id,
        phone: phone,
        lid: isLid(id) ? id : first(raw, 'lid', 'LID'),
        name: name,
        pushName: pushName,
        businessName: businessName,
        displayName: name || businessName || pushName || formatPhone(phone) || jidUser(id),
        saved: typeof raw?.isMyContact === 'boolean' ? raw.isMyContact : !!name,
        business: !!(raw?.isBusiness || raw?.isEnterprise || businessName),
        blocked: !!raw?.isBlocked,
        isMe: !!raw?.isMe,
    }
}

/** One row per person: the same phone may come as @c.us and @lid */
export function normalizeContacts(list: any[]): ContactRow[] {
    const byKey = new Map<string, ContactRow>()
    for (const raw of list || []) {
        const contact = normalizeContact(raw)
        if (!contact) continue
        const key = contact.phone || contact.id
        const existing = byKey.get(key)
        if (!existing) {
            byKey.set(key, contact)
            continue
        }
        // Merge the richer record
        byKey.set(key, {
            ...existing,
            name: existing.name || contact.name,
            pushName: existing.pushName || contact.pushName,
            businessName: existing.businessName || contact.businessName,
            lid: existing.lid || contact.lid,
            displayName: existing.name || contact.name || existing.displayName,
            saved: existing.saved || contact.saved,
            business: existing.business || contact.business,
            blocked: existing.blocked || contact.blocked,
        })
    }
    return [...byKey.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))
}

export function normalizeGroups(response: any): GroupRow[] {
    const list = Array.isArray(response) ? response : Object.values(response || {})
    const groups: GroupRow[] = []
    const seen = new Set<string>()
    for (const raw of list as any[]) {
        const id = jidOf(raw?.id) || first(raw, 'JID', 'jid')
        if (!id || seen.has(id)) continue
        seen.add(id)
        const name = first(raw, 'subject', 'name', 'Name')
            || raw?.groupMetadata?.subject
            || raw?.GroupName?.Name
            || jidUser(id)
        const participants = raw?.participants || raw?.Participants || raw?.groupMetadata?.participants
        const size = Array.isArray(participants) ? participants.length : (Number(raw?.size || raw?.ParticipantCount) || null)
        groups.push({id, name, size})
    }
    return groups.sort((a, b) => a.name.localeCompare(b.name))
}

const ROLE_RANK: Record<string, number> = {superadmin: 3, admin: 2, participant: 1, left: 0}

export function roleRank(role: string): number {
    return ROLE_RANK[role] ?? 1
}

/**
 * Merges participants of many groups into one row per person (phone, or id when the phone is hidden)
 */
export function buildMembers(
    results: { group: GroupRow, participants: any[] }[],
    lidToPhone: Map<string, string>,
    nameOf: (phone: string, id: string) => string,
): MemberRow[] {
    const byKey = new Map<string, MemberRow>()
    for (const {group, participants} of results) {
        for (const participant of participants || []) {
            const id = jidOf(participant?.id)
            if (!id) continue
            const role: ParticipantRole = participant.role || (participant.isSuperAdmin ? 'superadmin' : participant.isAdmin ? 'admin' : 'participant')
            const phone = phoneOf(id) || phoneOf(participant.pn) || phoneOf(lidToPhone.get(id))
            const lid = isLid(id) ? id : ''
            const key = phone || id
            let row = byKey.get(key)
            if (!row) {
                row = {key, id, phone, lid, displayName: '', role, groups: []}
                byKey.set(key, row)
            }
            row.lid = row.lid || lid
            if (!row.groups.some((item) => item.id === group.id)) {
                row.groups.push({id: group.id, name: group.name, role})
            }
            if (roleRank(role) > roleRank(row.role)) row.role = role
        }
    }
    const rows = [...byKey.values()]
    for (const row of rows) {
        row.displayName = nameOf(row.phone, row.id) || formatPhone(row.phone) || jidUser(row.id)
    }
    return rows.sort((a, b) => b.groups.length - a.groups.length || a.displayName.localeCompare(b.displayName))
}

//
// Loading helpers
//

/**
 * Loads every page. Stops on a short page, and when a page brings nothing new
 * (engines that ignore limit/offset return everything every time).
 */
export async function fetchAllPages(
    fetchPage: (limit: number, offset: number) => Promise<any>,
    keyOf: (item: any) => string,
    onProgress?: (count: number) => void,
    pageSize = 500,
    maxItems = 200000,
): Promise<any[]> {
    const items: any[] = []
    const seen = new Set<string>()
    for (let offset = 0; offset < maxItems; offset += pageSize) {
        const response = await fetchPage(pageSize, offset)
        const page: any[] = Array.isArray(response) ? response : Object.values(response || {})
        let added = 0
        for (const item of page) {
            const key = keyOf(item)
            if (key && seen.has(key)) continue
            if (key) seen.add(key)
            items.push(item)
            added++
        }
        onProgress?.(items.length)
        if (page.length < pageSize || added === 0) break
    }
    return items
}

export async function mapLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
    onDone?: (done: number) => void,
    isCancelled?: () => boolean,
): Promise<({ ok: true, value: R } | { ok: false, error: any })[]> {
    const results: any[] = new Array(items.length)
    let next = 0
    let done = 0
    async function worker() {
        while (next < items.length && !isCancelled?.()) {
            const index = next++
            try {
                results[index] = {ok: true, value: await fn(items[index])}
            } catch (error) {
                results[index] = {ok: false, error}
            }
            onDone?.(++done)
        }
    }
    await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker))
    return results.filter(Boolean)
}

//
// Export
//

/** Values that spreadsheets would execute as formulas (names come from other people) */
const FORMULA_RE = /^[=+\-@\t\r]/

export function csvCell(value: any, raw = false): string {
    let text = value === null || value === undefined ? '' : String(value)
    if (!raw && FORMULA_RE.test(text)) {
        text = `'${text}`
    }
    if (/[",\n\r;]/.test(text)) {
        text = `"${text.replace(/"/g, '""')}"`
    }
    return text
}

/**
 * CSV with a UTF-8 BOM so Excel shows Persian / Arabic names correctly
 * @param rawColumns column indexes generated by us (e.g. "+972..." phones) - not formula-escaped
 */
export function toCsv(headers: string[], rows: any[][], rawColumns: number[] = []): string {
    const raw = new Set(rawColumns)
    const lines = [headers.map((header) => csvCell(header)).join(',')]
    for (const row of rows) {
        lines.push(row.map((value, index) => csvCell(value, raw.has(index))).join(','))
    }
    return '﻿' + lines.join('\r\n') + '\r\n'
}

function vcardEscape(value: string): string {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/\r?\n/g, '\\n')
        .replace(/([,;])/g, '\\$1')
}

export interface VCardEntry {
    name: string
    phone: string
    org?: string
    note?: string
}

/** vCard 3.0 - imports into Android, iPhone, Google Contacts and Outlook; waid keeps the WhatsApp link */
export function toVCards(entries: VCardEntry[]): string {
    const cards: string[] = []
    for (const entry of entries) {
        if (!entry.phone) continue
        const name = entry.name || `+${entry.phone}`
        const lines = [
            'BEGIN:VCARD',
            'VERSION:3.0',
            `FN:${vcardEscape(name)}`,
            `N:;${vcardEscape(name)};;;`,
            `TEL;TYPE=CELL;waid=${entry.phone}:+${entry.phone}`,
        ]
        if (entry.org) lines.push(`ORG:${vcardEscape(entry.org)}`)
        if (entry.note) lines.push(`NOTE:${vcardEscape(entry.note)}`)
        lines.push('END:VCARD')
        cards.push(lines.join('\r\n'))
    }
    return cards.join('\r\n') + '\r\n'
}

export function exportFileName(base: string, sessionName: string, extension: string): string {
    const date = new Date()
    const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const safe = (value: string) => String(value).replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '')
    return `${safe(base)}-${safe(sessionName)}-${stamp}.${extension}`
}

export function downloadText(content: string, fileName: string, mimeType: string) {
    const blob = new Blob([content], {type: `${mimeType};charset=utf-8`})
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}
