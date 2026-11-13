/**
 * Safe rendering of WhatsApp message text.
 *
 * Message bodies come from other people, so everything is HTML-escaped first and only
 * a small whitelist of markup is produced: WhatsApp styles (*bold*, _italic_, ~strike~,
 * ```code block```, `inline code`, "> quote"), clickable http(s) links and @mentions.
 */

const ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
}

export function escapeHtml(text: string): string {
    return String(text).replace(/[&<>"']/g, (char) => ESCAPES[char])
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi
const MENTION_RE = /(^|[^\p{L}\p{N}@])@(\d{5,20})(?![\p{L}\p{N}])/gu
const TRAILING_PUNCTUATION = '.,!?;:\'"*_~'

function trimUrl(raw: string): { url: string, trailing: string } {
    let url = raw
    let trailing = ''
    while (url.length > 0) {
        const last = url[url.length - 1]
        const unbalancedParen = last === ')' && (url.split('(').length < url.split(')').length)
        if (TRAILING_PUNCTUATION.includes(last) || unbalancedParen) {
            trailing = last + trailing
            url = url.slice(0, -1)
            continue
        }
        break
    }
    return {url, trailing}
}

function applyStyle(text: string, marker: string, tag: string): string {
    const m = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Same rules as WhatsApp: markers must touch the text and sit on word boundaries,
    // so snake_case_names or 2*3*4 stay untouched.
    const re = new RegExp(
        `(^|[^\\p{L}\\p{N}${m}])${m}(?=\\S)([^${m}\\n]*?\\S)${m}(?=$|[^\\p{L}\\p{N}${m}])`,
        'gu',
    )
    return text.replace(re, (_, before, content) => `${before}<${tag}>${content}</${tag}>`)
}

export interface FormatOptions {
    /** Number (without @c.us) -> display name, used to render @mentions */
    mentions?: Record<string, string>
}

export function formatMessageText(text: string | null | undefined, options: FormatOptions = {}): string {
    if (!text) {
        return ''
    }
    const tokens: string[] = []
    const hold = (html: string) => `\u0000${tokens.push(html) - 1}\u0000`

    let s = String(text).replace(/\u0000/g, '')
    s = s.replace(/```([\s\S]+?)```/g, (_, code) => hold(`<pre class="wa-pre">${escapeHtml(code.replace(/^\n/, ''))}</pre>`))
    s = s.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code class="wa-code">${escapeHtml(code)}</code>`))
    s = s.replace(URL_RE, (match) => {
        const {url, trailing} = trimUrl(match)
        if (!url) {
            return match
        }
        const href = /^https?:\/\//i.test(url) ? url : `https://${url}`
        return hold(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`) + trailing
    })

    s = escapeHtml(s)
    s = s.replace(MENTION_RE, (_, before, number) => {
        const name = options.mentions?.[number] || number
        return `${before}${hold(`<span class="wa-mention">@${escapeHtml(name)}</span>`)}`
    })
    s = applyStyle(s, '*', 'strong')
    s = applyStyle(s, '_', 'em')
    s = applyStyle(s, '~', 's')

    s = s
        .split('\n')
        .map((line) => line.startsWith('&gt; ') ? `<span class="wa-quote">${line.slice(5)}</span>` : line)
        .join('<br>')

    return s.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)])
}

const PICTOGRAPHIC_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u
const EMOJI_PART_RE = /^[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}‍️⃣]+$/u

/**
 * "👍" or "😂😂😂" - WhatsApp shows short emoji-only messages bigger
 */
export function isEmojiOnly(text: string | null | undefined, max = 3): boolean {
    const value = (text || '').replace(/\s+/g, '')
    if (!value || value.length > 40 || typeof Intl === 'undefined' || !(Intl as any).Segmenter) {
        return false
    }
    const segments = [...new (Intl as any).Segmenter(undefined, {granularity: 'grapheme'}).segment(value)]
    if (segments.length === 0 || segments.length > max) {
        return false
    }
    return segments.every(({segment}: any) => PICTOGRAPHIC_RE.test(segment) && EMOJI_PART_RE.test(segment))
}

export function formatBytes(bytes: number | null | undefined): string {
    if (!bytes || bytes <= 0) {
        return ''
    }
    const units = ['B', 'KB', 'MB', 'GB']
    let value = bytes
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit++
    }
    return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

export function formatDuration(seconds: number | null | undefined): string {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
        return '0:00'
    }
    const total = Math.round(seconds)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    const ss = String(s).padStart(2, '0')
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const RTL_CHAR_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/
const LETTER_RE = /\p{L}/u

/**
 * Direction of a text by its first strong letter - the same rule as dir="auto"
 */
export function textDirection(text: string | null | undefined): 'rtl' | 'ltr' {
    for (const char of String(text || '')) {
        if (LETTER_RE.test(char)) {
            return RTL_CHAR_RE.test(char) ? 'rtl' : 'ltr'
        }
    }
    return 'ltr'
}

const SENDER_COLORS = [
    'var(--blue-500, #3b82f6)',
    'var(--orange-500, #f97316)',
    'var(--purple-500, #a855f7)',
    'var(--teal-500, #14b8a6)',
    'var(--pink-500, #ec4899)',
    'var(--indigo-500, #6366f1)',
    'var(--cyan-600, #0891b2)',
    'var(--yellow-600, #ca8a04)',
    'var(--green-600, #16a34a)',
    'var(--red-500, #ef4444)',
]

/**
 * Stable color per group participant, like WhatsApp does for sender names
 */
export function senderColor(id: string | null | undefined): string {
    if (!id || id === 'me') {
        return 'var(--primary-color)'
    }
    let hash = 0
    for (const char of String(id)) {
        hash = (hash * 31 + char.charCodeAt(0)) | 0
    }
    return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length]
}

/**
 * "972501234567@c.us" -> "+972501234567", "1234@lid" -> "1234"
 */
export function formatJid(jid: string | null | undefined): string {
    if (!jid) {
        return ''
    }
    const [user, server] = String(jid).split('@')
    const number = user.split(':')[0]
    if (server === 'c.us' || server === 's.whatsapp.net') {
        return `+${number}`
    }
    return number
}
