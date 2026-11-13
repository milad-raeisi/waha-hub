/**
 * Normalizes a WAHA message (WEBJS, NOWEB or GOWS engine) into a single view model,
 * so the chat UI can render every message type the same way regardless of the engine.
 *
 * WAHA's top-level fields (body, hasMedia, media, location, vCards, replyTo) are engine-agnostic,
 * but most details (media type, duration, thumbnails, polls, reactions, edits, system events)
 * only live in the engine specific "_data" payload:
 *  - WEBJS: _data.type ("chat", "image", "ptt", ...) + flat fields
 *  - NOWEB: _data.message (protobuf as JSON, camelCase) + _data.key / messageStubType
 *  - GOWS: _data.Message (protobuf as JSON) + _data.Info
 */
import {parseVCard, type VCardContact} from './vcard'

export type Engine = 'WEBJS' | 'NOWEB' | 'GOWS' | 'UNKNOWN'

export type MessageKind =
    | 'text'
    | 'image'
    | 'video'
    | 'gif'
    | 'ptv'
    | 'audio'
    | 'voice'
    | 'document'
    | 'sticker'
    | 'location'
    | 'contacts'
    | 'poll'
    | 'event'
    | 'group-invite'
    | 'interactive'
    | 'call'
    | 'revoked'
    | 'pending'
    | 'system'
    // Applied to other messages, never rendered on their own
    | 'reaction'
    | 'edit'
    | 'hidden'
    | 'unsupported'

export const MEDIA_KINDS: MessageKind[] = ['image', 'video', 'gif', 'ptv', 'audio', 'voice', 'document', 'sticker']
export const VISUAL_MEDIA_KINDS: MessageKind[] = ['image', 'video', 'gif', 'ptv', 'sticker']
/** Rendered as a centered notice instead of a bubble */
export const CENTER_KINDS: MessageKind[] = ['system', 'call']
const CAPTION_KINDS: MessageKind[] = ['text', 'image', 'video', 'gif', 'ptv', 'document', 'interactive']

export interface ParsedMedia {
    mimetype?: string
    filename?: string
    size?: number
    /** Seconds */
    duration?: number
    width?: number
    height?: number
    /** data: URL of the low-res preview */
    thumbnail?: string
    /** 0..100 values (voice messages) */
    waveform?: number[]
    pages?: number
    animated?: boolean
    viewOnce?: boolean
}

export interface ParsedLocation {
    latitude?: number
    longitude?: number
    name?: string
    address?: string
    url?: string
    live?: boolean
    thumbnail?: string
}

export interface ParsedPoll {
    name: string
    options: string[]
    /** 0 - any number of options */
    selectable: number
}

export interface ParsedQuote {
    key: string | null
    participant: string | null
    kind: MessageKind
    text: string
    filename?: string
    thumbnail?: string
}

export interface ParsedMessage {
    engine: Engine
    kind: MessageKind
    /** Engine specific type, for debugging and "unsupported" messages */
    rawType: string
    text: string
    media?: ParsedMedia
    location?: ParsedLocation
    contacts?: VCardContact[]
    poll?: ParsedPoll
    event?: { name: string, description?: string, start?: number, location?: string }
    invite?: { groupName: string, caption?: string, code?: string }
    interactive?: { title?: string, footer?: string, buttons: string[] }
    call?: { video: boolean, missed: boolean, duration?: number }
    system?: { key: string, params: Record<string, string> }
    reaction?: { targetKey: string, emoji: string }
    edit?: { targetKey: string, text: string }
    revokeTarget?: string
    quote?: ParsedQuote
    linkPreview?: { url?: string, title?: string, description?: string, thumbnail?: string }
    forwarded: boolean
    forwardedMany: boolean
    edited: boolean
    senderName: string
}

//
// Low level helpers
//

function pick(obj: any, ...keys: string[]): any {
    if (!obj || typeof obj !== 'object') {
        return undefined
    }
    for (const key of keys) {
        const value = obj[key]
        if (value !== undefined && value !== null && value !== '') {
            return value
        }
    }
    return undefined
}

export function toNumber(value: any): number | undefined {
    if (value === null || value === undefined || value === '') {
        return undefined
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined
    }
    if (typeof value === 'string') {
        const number = Number(value)
        return Number.isFinite(number) ? number : undefined
    }
    if (typeof value === 'bigint') {
        return Number(value)
    }
    // protobuf.js Long
    if (typeof value === 'object' && 'low' in value && 'high' in value) {
        return value.high * 4294967296 + (value.low >>> 0)
    }
    return undefined
}

function arrayToBase64(values: number[]): string {
    let binary = ''
    for (let i = 0; i < values.length; i++) {
        binary += String.fromCharCode(values[i] & 255)
    }
    return btoa(binary)
}

/**
 * Bytes fields are serialized differently per engine:
 * base64 string (GOWS, WEBJS), {type: 'Buffer', data} (NOWEB) or {"0": 1, "1": 2} (Uint8Array)
 */
function bytesToBase64(value: any): string | undefined {
    if (!value) {
        return undefined
    }
    if (typeof value === 'string') {
        return value
    }
    if (Array.isArray(value)) {
        return arrayToBase64(value)
    }
    if (typeof value === 'object') {
        if (value.type === 'Buffer') {
            if (typeof value.data === 'string') {
                return value.data
            }
            if (Array.isArray(value.data)) {
                return arrayToBase64(value.data)
            }
        }
        const keys = Object.keys(value)
        if (keys.length > 0 && keys.every((key) => /^\d+$/.test(key))) {
            return arrayToBase64(keys.sort((a, b) => Number(a) - Number(b)).map((key) => value[key]))
        }
    }
    return undefined
}

function bytesToArray(value: any): number[] | undefined {
    if (!value) {
        return undefined
    }
    if (Array.isArray(value)) {
        return value
    }
    if (value?.type === 'Buffer' && Array.isArray(value.data)) {
        return value.data
    }
    const base64 = bytesToBase64(value)
    if (!base64) {
        return undefined
    }
    try {
        return Array.from(atob(base64), (char) => char.charCodeAt(0))
    } catch {
        return undefined
    }
}

function normalizeWaveform(values: number[] | undefined): number[] | undefined {
    if (!values || values.length === 0) {
        return undefined
    }
    const max = Math.max(...values, 1)
    return values.map((value) => Math.round((value / max) * 100))
}

const BASE64_RE = /^[A-Za-z0-9+/=\r\n]+$/

export function thumbnailUrl(value: any, strict = false): string | undefined {
    const base64 = bytesToBase64(value)
    if (!base64 || base64.length < 40) {
        return undefined
    }
    if (base64.startsWith('data:image/')) {
        return base64
    }
    if (!BASE64_RE.test(base64.slice(0, 200))) {
        return undefined
    }
    const isJpeg = base64.startsWith('/9j/')
    const isPng = base64.startsWith('iVBOR')
    const isWebp = base64.startsWith('UklGR')
    if (strict && !isJpeg && !isPng && !isWebp) {
        return undefined
    }
    const mime = isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/jpeg'
    return `data:${mime};base64,${base64}`
}

function jidOf(value: any): string | null {
    if (!value) {
        return null
    }
    if (typeof value === 'string') {
        return value
    }
    return value._serialized || value.id || null
}

/**
 * WAHA message id "true_123@c.us_3EB0ABC[_participant]" -> "3EB0ABC".
 * Reactions, edits and replies reference messages by this short id.
 */
export function messageKey(id: any): string {
    if (!id) {
        return ''
    }
    if (typeof id === 'object') {
        return id.id || id.ID || id._serialized || ''
    }
    const parts = String(id).split('_')
    if (parts.length >= 3 && (parts[0] === 'true' || parts[0] === 'false')) {
        return parts[2]
    }
    return String(id)
}

function detectEngine(data: any): Engine {
    if (!data || typeof data !== 'object') {
        return 'UNKNOWN'
    }
    if (data.Info || data.Message) {
        return 'GOWS'
    }
    if (data.key && ('message' in data || 'messageStubType' in data || 'messageTimestamp' in data)) {
        return 'NOWEB'
    }
    if (typeof data.type === 'string' || data.id?._serialized) {
        return 'WEBJS'
    }
    return 'UNKNOWN'
}

function emptyParsed(engine: Engine): ParsedMessage {
    return {
        engine: engine,
        kind: 'unsupported',
        rawType: '',
        text: '',
        forwarded: false,
        forwardedMany: false,
        edited: false,
        senderName: '',
    }
}

//
// NOWEB + GOWS (protobuf)
//

const WRAPPERS = [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage',
    'deviceSentMessage',
    'editedMessage',
    'futureProofMessage',
    'groupMentionedMessage',
    'botInvokeMessage',
    'lottieStickerMessage',
    'associatedChildMessage',
    'statusMentionMessage',
]

function unwrap(raw: any): { m: any, viewOnce: boolean } {
    let m = raw
    let viewOnce = false
    for (let depth = 0; depth < 8 && m && typeof m === 'object'; depth++) {
        const wrapper = WRAPPERS.find((key) => m[key]?.message)
        if (!wrapper) {
            break
        }
        if (wrapper.startsWith('viewOnce')) {
            viewOnce = true
        }
        m = m[wrapper].message
    }
    return {m, viewOnce}
}

function protoText(m: any): string {
    if (!m || typeof m !== 'object') {
        return ''
    }
    return pick(m, 'conversation')
        || m.extendedTextMessage?.text
        || m.imageMessage?.caption
        || m.videoMessage?.caption
        || m.documentMessage?.caption
        || m.ptvMessage?.caption
        || ''
}

function findContextInfo(m: any): any {
    for (const [key, value] of Object.entries(m || {})) {
        if (key !== 'messageContextInfo' && value && typeof value === 'object' && (value as any).contextInfo) {
            return (value as any).contextInfo
        }
    }
    return null
}

function protoMedia(x: any, viewOnce: boolean): ParsedMedia {
    return {
        mimetype: pick(x, 'mimetype'),
        filename: pick(x, 'fileName', 'filename', 'title'),
        size: toNumber(pick(x, 'fileLength')),
        duration: toNumber(pick(x, 'seconds')),
        width: toNumber(pick(x, 'width')),
        height: toNumber(pick(x, 'height')),
        thumbnail: thumbnailUrl(pick(x, 'JPEGThumbnail', 'jpegThumbnail', 'pngThumbnail')),
        waveform: normalizeWaveform(bytesToArray(pick(x, 'waveform'))),
        pages: toNumber(pick(x, 'pageCount')),
        animated: !!pick(x, 'isAnimated', 'isAnimatedSticker'),
        viewOnce: viewOnce || !!pick(x, 'viewOnce'),
    }
}

function isEnum(value: any, number: number, name: string): boolean {
    return value === number || value === name || value === String(number)
}

function interactiveButtons(list: any[] | undefined, ...paths: string[][]): string[] {
    if (!Array.isArray(list)) {
        return []
    }
    return list
        .map((button) => {
            for (const path of paths) {
                let value = button
                for (const key of path) {
                    value = value?.[key]
                }
                if (typeof value === 'string' && value) {
                    return value
                }
            }
            if (button?.buttonParamsJson) {
                try {
                    return JSON.parse(button.buttonParamsJson).display_text || ''
                } catch {
                    return ''
                }
            }
            return ''
        })
        .filter(Boolean)
}

/**
 * Fills "out" from a protobuf Message (NOWEB "message" / GOWS "Message").
 * Returns false when nothing was recognized.
 */
function parseProtoContent(raw: any, out: ParsedMessage): boolean {
    const {m, viewOnce} = unwrap(raw)
    if (!m || typeof m !== 'object') {
        return false
    }
    out.rawType = Object.keys(m).filter((key) => key !== 'messageContextInfo').join(',')

    const protocol = m.protocolMessage
    if (protocol) {
        const targetKey = messageKey(protocol.key?.id ?? protocol.key?.ID)
        if (isEnum(protocol.type, 0, 'REVOKE')) {
            out.kind = 'revoked'
            out.revokeTarget = targetKey
        } else if (isEnum(protocol.type, 14, 'MESSAGE_EDIT')) {
            out.kind = 'edit'
            out.edit = {targetKey: targetKey, text: protoText(unwrap(protocol.editedMessage).m)}
        } else if (isEnum(protocol.type, 3, 'EPHEMERAL_SETTING')) {
            out.kind = 'system'
            out.system = {key: 'disappearing', params: {}}
        } else {
            out.kind = 'hidden'
        }
        return true
    }

    const context = findContextInfo(m)
    if (context) {
        out.forwarded = !!context.isForwarded
        out.forwardedMany = (toNumber(context.forwardingScore) || 0) >= 4
        const stanzaId = pick(context, 'stanzaId', 'stanzaID')
        if (stanzaId && context.quotedMessage) {
            out.quote = quoteFromProto(context.quotedMessage, stanzaId, pick(context, 'participant'))
        }
    }

    if (m.reactionMessage) {
        const reaction = m.reactionMessage
        out.kind = 'reaction'
        out.reaction = {
            targetKey: messageKey(reaction.key?.id ?? reaction.key?.ID),
            emoji: reaction.text || '',
        }
        return true
    }
    if (typeof m.conversation === 'string' && m.conversation) {
        out.kind = 'text'
        out.text = m.conversation
        return true
    }
    if (m.extendedTextMessage) {
        const ext = m.extendedTextMessage
        out.kind = 'text'
        out.text = ext.text || ''
        const url = pick(ext, 'canonicalURL', 'canonicalUrl', 'matchedText')
        if (url && (ext.title || ext.description)) {
            out.linkPreview = {
                url: url,
                title: ext.title,
                description: ext.description,
                thumbnail: thumbnailUrl(pick(ext, 'JPEGThumbnail', 'jpegThumbnail', 'thumbnail')),
            }
        }
        return true
    }
    if (m.imageMessage) {
        out.kind = 'image'
        out.media = protoMedia(m.imageMessage, viewOnce)
        out.text = m.imageMessage.caption || ''
        return true
    }
    if (m.videoMessage) {
        out.kind = m.videoMessage.gifPlayback ? 'gif' : 'video'
        out.media = protoMedia(m.videoMessage, viewOnce)
        out.text = m.videoMessage.caption || ''
        return true
    }
    if (m.ptvMessage) {
        out.kind = 'ptv'
        out.media = protoMedia(m.ptvMessage, viewOnce)
        return true
    }
    if (m.audioMessage) {
        const audio = m.audioMessage
        out.kind = pick(audio, 'ptt', 'PTT') ? 'voice' : 'audio'
        out.media = protoMedia(audio, viewOnce)
        return true
    }
    if (m.documentMessage) {
        out.kind = 'document'
        out.media = protoMedia(m.documentMessage, viewOnce)
        out.text = m.documentMessage.caption || ''
        return true
    }
    if (m.stickerMessage) {
        out.kind = 'sticker'
        out.media = protoMedia(m.stickerMessage, viewOnce)
        return true
    }
    if (m.locationMessage || m.liveLocationMessage) {
        const location = m.locationMessage || m.liveLocationMessage
        out.kind = 'location'
        out.location = {
            latitude: toNumber(location.degreesLatitude),
            longitude: toNumber(location.degreesLongitude),
            name: location.name,
            address: location.address || location.caption,
            url: location.URL || location.url,
            live: !!m.liveLocationMessage || !!location.isLive,
            thumbnail: thumbnailUrl(pick(location, 'JPEGThumbnail', 'jpegThumbnail')),
        }
        return true
    }
    if (m.contactMessage) {
        out.kind = 'contacts'
        out.contacts = [parseVCard(m.contactMessage.vcard, m.contactMessage.displayName)]
        return true
    }
    if (m.contactsArrayMessage) {
        out.kind = 'contacts'
        out.contacts = (m.contactsArrayMessage.contacts || []).map((contact: any) => parseVCard(contact.vcard, contact.displayName))
        return true
    }
    const poll = m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3 || m.pollCreationMessageV4 || m.pollCreationMessageV5
    if (poll) {
        out.kind = 'poll'
        out.poll = {
            name: poll.name || '',
            options: (poll.options || []).map((option: any) => option.optionName || option.name || '').filter(Boolean),
            selectable: toNumber(poll.selectableOptionsCount) || 0,
        }
        return true
    }
    if (m.eventMessage) {
        const event = m.eventMessage
        out.kind = 'event'
        out.event = {
            name: event.name || '',
            description: event.description,
            start: toNumber(event.startTime),
            location: event.location?.name || event.location?.address,
        }
        return true
    }
    if (m.groupInviteMessage) {
        const invite = m.groupInviteMessage
        out.kind = 'group-invite'
        out.invite = {groupName: invite.groupName || '', caption: invite.caption, code: invite.inviteCode}
        return true
    }
    if (m.buttonsMessage) {
        const buttons = m.buttonsMessage
        out.kind = 'interactive'
        out.text = buttons.contentText || buttons.text || ''
        out.interactive = {
            footer: buttons.footerText,
            buttons: interactiveButtons(buttons.buttons, ['buttonText', 'displayText']),
        }
        return true
    }
    if (m.templateMessage) {
        const template = m.templateMessage.hydratedTemplate || m.templateMessage.hydratedFourRowTemplate || {}
        out.kind = 'interactive'
        out.text = template.hydratedContentText || ''
        out.interactive = {
            title: template.hydratedTitleText,
            footer: template.hydratedFooterText,
            buttons: interactiveButtons(
                template.hydratedButtons,
                ['quickReplyButton', 'displayText'],
                ['urlButton', 'displayText'],
                ['callButton', 'displayText'],
            ),
        }
        return true
    }
    if (m.listMessage) {
        const list = m.listMessage
        out.kind = 'interactive'
        out.text = list.description || ''
        const rows = (list.sections || []).flatMap((section: any) => section.rows || [])
        out.interactive = {
            title: list.title,
            footer: list.footerText,
            buttons: [list.buttonText, ...rows.map((row: any) => row.title)].filter(Boolean),
        }
        return true
    }
    if (m.interactiveMessage) {
        const interactive = m.interactiveMessage
        out.kind = 'interactive'
        out.text = interactive.body?.text || ''
        out.interactive = {
            title: interactive.header?.title,
            footer: interactive.footer?.text,
            buttons: interactiveButtons(interactive.nativeFlowMessage?.buttons, ['name']),
        }
        return true
    }
    const response = m.buttonsResponseMessage || m.templateButtonReplyMessage || m.listResponseMessage || m.interactiveResponseMessage
    if (response) {
        out.kind = 'text'
        out.text = response.selectedDisplayText || response.title || response.body?.text || ''
        return true
    }
    if (m.orderMessage || m.productMessage) {
        const order = m.orderMessage
        const product = m.productMessage?.product
        out.kind = 'interactive'
        out.text = order?.message || product?.description || ''
        out.interactive = {title: order?.orderTitle || product?.title, buttons: []}
        return true
    }
    const callLog = m.callLogMesssage || m.callLogMessage
    if (callLog) {
        out.kind = 'call'
        out.call = {
            video: !!callLog.isVideo,
            missed: !isEnum(callLog.callOutcome, 0, 'CONNECTED'),
            duration: toNumber(callLog.durationSecs),
        }
        return true
    }
    if (m.bcallMessage || m.scheduledCallCreationMessage) {
        out.kind = 'call'
        out.call = {video: isEnum(m.scheduledCallCreationMessage?.callType, 2, 'VIDEO'), missed: false}
        return true
    }
    if (m.pinInChatMessage) {
        out.kind = 'system'
        out.system = {key: isEnum(m.pinInChatMessage.type, 2, 'UNPIN_FOR_ALL') ? 'unpinned' : 'pinned', params: {}}
        return true
    }
    if (m.requestPhoneNumberMessage) {
        out.kind = 'system'
        out.system = {key: 'phoneRequest', params: {}}
        return true
    }
    const NOISE = [
        'senderKeyDistributionMessage',
        'messageContextInfo',
        'pollUpdateMessage',
        'encReactionMessage',
        'encCommentMessage',
        'keepInChatMessage',
        'albumMessage',
        'appStateSyncKeyShare',
        'peerDataOperationRequestMessage',
        'peerDataOperationRequestResponseMessage',
        'call',
    ]
    if (Object.keys(m).every((key) => NOISE.includes(key))) {
        out.kind = 'hidden'
        return true
    }
    return false
}

function quoteFromProto(quoted: any, stanzaId: string, participant: string | null): ParsedQuote {
    const parsed = emptyParsed('UNKNOWN')
    parseProtoContent(quoted, parsed)
    return {
        key: stanzaId,
        participant: participant || null,
        kind: parsed.kind,
        text: quoteText(parsed),
        filename: parsed.media?.filename,
        thumbnail: parsed.media?.thumbnail || parsed.location?.thumbnail,
    }
}

function quoteText(parsed: ParsedMessage): string {
    if (parsed.kind === 'poll') {
        return parsed.poll?.name || ''
    }
    if (parsed.kind === 'contacts') {
        return parsed.contacts?.map((contact) => contact.name).join(', ') || ''
    }
    if (parsed.kind === 'location') {
        return parsed.location?.name || parsed.location?.address || ''
    }
    if (parsed.kind === 'document') {
        return parsed.text || parsed.media?.filename || ''
    }
    return parsed.text || ''
}

//
// NOWEB system messages (no "message", only messageStubType)
//

const STUB_TYPES: Record<number, string> = {
    1: 'REVOKE',
    2: 'CIPHERTEXT',
    20: 'GROUP_CREATE',
    21: 'GROUP_CHANGE_SUBJECT',
    22: 'GROUP_CHANGE_ICON',
    23: 'GROUP_CHANGE_INVITE_LINK',
    24: 'GROUP_CHANGE_DESCRIPTION',
    25: 'GROUP_CHANGE_RESTRICT',
    26: 'GROUP_CHANGE_ANNOUNCE',
    27: 'GROUP_PARTICIPANT_ADD',
    28: 'GROUP_PARTICIPANT_REMOVE',
    29: 'GROUP_PARTICIPANT_PROMOTE',
    30: 'GROUP_PARTICIPANT_DEMOTE',
    31: 'GROUP_PARTICIPANT_INVITE',
    32: 'GROUP_PARTICIPANT_LEAVE',
    33: 'GROUP_PARTICIPANT_CHANGE_NUMBER',
    38: 'E2E_IDENTITY_CHANGED',
    39: 'E2E_ENCRYPTED',
    40: 'CALL_MISSED_VOICE',
    41: 'CALL_MISSED_VIDEO',
    45: 'CALL_MISSED_GROUP_VOICE',
    46: 'CALL_MISSED_GROUP_VIDEO',
}

function formatUser(value: string): string {
    let jid = value
    if (value.startsWith('{')) {
        try {
            const parsed = JSON.parse(value)
            jid = parsed.phoneNumber || parsed.id || value
        } catch {
            // keep as is
        }
    }
    const [user, server] = jid.split('@')
    if (!server) {
        return jid
    }
    const number = user.split(':')[0]
    return server === 's.whatsapp.net' || server === 'c.us' ? `+${number}` : number
}

function parseStub(data: any, out: ParsedMessage): boolean {
    const raw = data.messageStubType
    if (raw === undefined || raw === null || raw === 0 || raw === 'UNKNOWN') {
        return false
    }
    const name = typeof raw === 'number' ? (STUB_TYPES[raw] || `STUB_${raw}`) : String(raw)
    const stubParams: string[] = (data.messageStubParameters || []).map((param: any) => String(param))
    const users = stubParams.map(formatUser).join(', ')
    out.rawType = name
    const system = (key: string, params: Record<string, string> = {}) => {
        out.kind = 'system'
        out.system = {key, params}
    }
    switch (name) {
        case 'REVOKE':
            out.kind = 'revoked'
            break
        case 'CIPHERTEXT':
            out.kind = 'pending'
            break
        case 'GROUP_CREATE':
            system('group.create', {subject: stubParams[0] || ''})
            break
        case 'GROUP_CHANGE_SUBJECT':
            system('group.subject', {subject: stubParams[0] || ''})
            break
        case 'GROUP_CHANGE_ICON':
            system('group.picture')
            break
        case 'GROUP_CHANGE_INVITE_LINK':
            system('group.inviteLink')
            break
        case 'GROUP_CHANGE_DESCRIPTION':
            system('group.description')
            break
        case 'GROUP_CHANGE_RESTRICT':
        case 'GROUP_CHANGE_ANNOUNCE':
            system('group.settings')
            break
        case 'GROUP_PARTICIPANT_ADD':
        case 'GROUP_PARTICIPANT_INVITE':
            system('group.add', {users})
            break
        case 'GROUP_PARTICIPANT_REMOVE':
            system('group.remove', {users})
            break
        case 'GROUP_PARTICIPANT_LEAVE':
            system('group.leave', {users})
            break
        case 'GROUP_PARTICIPANT_PROMOTE':
            system('group.promote', {users})
            break
        case 'GROUP_PARTICIPANT_DEMOTE':
            system('group.demote', {users})
            break
        case 'GROUP_PARTICIPANT_CHANGE_NUMBER':
            system('numberChanged', {users})
            break
        case 'E2E_IDENTITY_CHANGED':
            system('securityCode')
            break
        case 'E2E_ENCRYPTED':
            system('e2e')
            break
        case 'CALL_MISSED_VOICE':
        case 'CALL_MISSED_GROUP_VOICE':
            out.kind = 'call'
            out.call = {video: false, missed: true}
            break
        case 'CALL_MISSED_VIDEO':
        case 'CALL_MISSED_GROUP_VIDEO':
            out.kind = 'call'
            out.call = {video: true, missed: true}
            break
        default:
            system('generic', {type: name})
    }
    return true
}

//
// WEBJS
//

const WEBJS_GROUP_EVENTS: Record<string, string> = {
    create: 'group.create',
    add: 'group.add',
    invite: 'group.add',
    v4_add_invite_join: 'group.add',
    remove: 'group.remove',
    leave: 'group.leave',
    subject: 'group.subject',
    description: 'group.description',
    picture: 'group.picture',
    promote: 'group.promote',
    demote: 'group.demote',
    announce: 'group.settings',
    restrict: 'group.settings',
    ephemeral: 'disappearing',
}

function webjsKind(type: string, d: any): MessageKind {
    switch (type) {
        case 'chat':
            return 'text'
        case 'image':
            return 'image'
        case 'video':
            return d?.isGif ? 'gif' : 'video'
        case 'ptv':
            return 'ptv'
        case 'audio':
            return 'audio'
        case 'ptt':
            return 'voice'
        case 'document':
            return 'document'
        case 'sticker':
            return 'sticker'
        case 'location':
            return 'location'
        case 'vcard':
        case 'multi_vcard':
            return 'contacts'
        case 'poll_creation':
            return 'poll'
        case 'revoked':
            return 'revoked'
        default:
            return 'text'
    }
}

function webjsThumbnail(value: any): string | undefined {
    return thumbnailUrl(value, true)
}

function parseWebjs(d: any, message: any, out: ParsedMessage): boolean {
    const type: string = d.type || ''
    out.rawType = type
    out.senderName = d.notifyName || ''
    out.forwarded = !!d.isForwarded
    out.forwardedMany = (toNumber(d.forwardingScore) || 0) >= 4
    out.edited = !!(d.latestEditMsgKey || d.latestEditSenderTimestampMs)

    if (d.quotedMsg) {
        const quoted = d.quotedMsg
        const kind = webjsKind(quoted.type, quoted)
        out.quote = {
            key: d.quotedStanzaID || null,
            participant: jidOf(d.quotedParticipant),
            kind: kind,
            text: kind === 'text' ? (quoted.body || '') : (quoted.caption || quoted.filename || quoted.pollName || ''),
            filename: quoted.filename,
            thumbnail: ['image', 'video', 'gif', 'location'].includes(kind) ? webjsThumbnail(quoted.body) : undefined,
        }
    }

    const media = (extra: Partial<ParsedMedia> = {}): ParsedMedia => ({
        mimetype: d.mimetype,
        filename: d.filename,
        size: toNumber(d.size),
        duration: toNumber(d.duration),
        width: toNumber(d.width),
        height: toNumber(d.height),
        viewOnce: !!d.isViewOnce,
        ...extra,
    })
    const caption = d.caption ?? message?.body ?? ''

    switch (type) {
        case 'chat':
            out.kind = 'text'
            out.text = message?.body ?? d.body ?? ''
            if (d.title || d.description) {
                out.linkPreview = {
                    url: d.canonicalUrl || d.matchedText,
                    title: d.title,
                    description: d.description,
                    thumbnail: webjsThumbnail(d.thumbnail),
                }
            }
            return true
        case 'image':
        case 'video':
        case 'ptv':
            out.kind = webjsKind(type, d)
            out.media = media({thumbnail: webjsThumbnail(d.body)})
            out.text = type === 'ptv' ? '' : caption
            return true
        case 'audio':
        case 'ptt':
            out.kind = webjsKind(type, d)
            out.media = media({waveform: normalizeWaveform(bytesToArray(d.waveform))})
            return true
        case 'document':
            out.kind = 'document'
            out.media = media({thumbnail: webjsThumbnail(d.body), pages: toNumber(d.pageCount)})
            out.text = caption
            return true
        case 'sticker':
            out.kind = 'sticker'
            out.media = media({animated: !!(d.isAnimated || d.isAvatar === false && d.isLottie)})
            return true
        case 'location': {
            const [name, ...address] = String(d.loc || '').split('\n')
            out.kind = 'location'
            out.location = {
                latitude: toNumber(d.lat),
                longitude: toNumber(d.lng),
                name: name || undefined,
                address: address.join(', ') || undefined,
                url: d.clientUrl,
                live: !!d.isLive,
                thumbnail: webjsThumbnail(d.body),
            }
            return true
        }
        case 'vcard':
            out.kind = 'contacts'
            out.contacts = [parseVCard(d.body, d.vcardFormattedName)]
            return true
        case 'multi_vcard':
            out.kind = 'contacts'
            out.contacts = (d.vcardList || []).map((contact: any) => parseVCard(contact.vcard, contact.displayName))
            return true
        case 'revoked':
            out.kind = 'revoked'
            return true
        case 'poll_creation':
            out.kind = 'poll'
            out.poll = {
                name: d.pollName || message?.body || '',
                options: (d.pollOptions || []).map((option: any) => option.name).filter(Boolean),
                selectable: toNumber(d.pollSelectableOptionsCount) || 0,
            }
            return true
        case 'event_creation':
            out.kind = 'event'
            out.event = {
                name: d.eventName || message?.body || '',
                description: d.eventDescription,
                start: toNumber(d.eventStartTime),
                location: d.eventLocation?.name,
            }
            return true
        case 'groups_v4_invite':
            out.kind = 'group-invite'
            out.invite = {groupName: d.inviteGrpName || '', caption: d.comment, code: d.inviteCode}
            return true
        case 'e2e_notification':
            out.kind = 'system'
            out.system = {key: 'e2e', params: {}}
            return true
        case 'notification_template':
            out.kind = 'system'
            out.system = {
                key: ['disappearing_mode_update', 'change_ephemeral_setting'].includes(d.subtype) ? 'disappearing' : 'generic',
                params: {type: d.subtype || type},
            }
            return true
        case 'gp2': {
            const users = (d.recipients || []).map((recipient: any) => formatUser(jidOf(recipient) || '')).join(', ')
            out.kind = 'system'
            out.system = {
                key: WEBJS_GROUP_EVENTS[d.subtype] || 'generic',
                params: {users: users, subject: d.body || '', type: d.subtype || type},
            }
            return true
        }
        case 'call_log':
            out.kind = 'call'
            out.call = {
                video: !!d.isVideoCall,
                missed: /miss|reject|cancel|unanswered/i.test(`${d.callOutcome || ''} ${d.subtype || ''}`),
                duration: toNumber(d.callDuration),
            }
            return true
        case 'ciphertext':
            out.kind = 'pending'
            return true
        case 'pinned_message':
            out.kind = 'system'
            out.system = {key: 'pinned', params: {}}
            return true
        case 'protocol':
        case 'reaction':
        case 'keep_in_chat':
        case 'poll_update':
            out.kind = 'hidden'
            return true
        case 'list':
        case 'buttons':
        case 'interactive':
        case 'native_flow':
        case 'hsm':
        case 'order':
        case 'product':
        case 'list_response':
        case 'buttons_response':
        case 'template_button_reply':
            out.kind = 'interactive'
            out.text = message?.body || d.body || ''
            out.interactive = {title: d.title, footer: d.footer, buttons: []}
            return true
        case 'broadcast_notification':
        case 'notification':
            out.kind = 'system'
            out.system = {key: 'generic', params: {type: d.subtype || type}}
            return true
    }
    return false
}

//
// Public API
//

function kindFromMimetype(mimetype: string | undefined): MessageKind {
    const mime = mimetype || ''
    if (mime.startsWith('image/webp')) {
        return 'sticker'
    }
    if (mime.startsWith('image/')) {
        return 'image'
    }
    if (mime.startsWith('video/')) {
        return 'video'
    }
    if (mime.startsWith('audio/')) {
        return 'audio'
    }
    return 'document'
}

function applyTopLevel(message: any, out: ParsedMessage, recognized: boolean) {
    if (!recognized) {
        if (message.location) {
            out.kind = 'location'
        } else if (Array.isArray(message.vCards) && message.vCards.length > 0) {
            out.kind = 'contacts'
            out.contacts = message.vCards.map((vcard: string) => parseVCard(vcard))
        } else if (message.hasMedia) {
            out.kind = kindFromMimetype(message.media?.mimetype)
        } else if (message.body) {
            out.kind = 'text'
        }
    }

    if (CAPTION_KINDS.includes(out.kind) && !out.text && message.body) {
        out.text = message.body
    }

    if (MEDIA_KINDS.includes(out.kind)) {
        out.media = out.media || {}
        out.media.mimetype = out.media.mimetype || message.media?.mimetype
        out.media.filename = out.media.filename || message.media?.filename
    }

    if (out.kind === 'location' && message.location) {
        const location = message.location
        out.location = {
            latitude: out.location?.latitude ?? toNumber(location.latitude),
            longitude: out.location?.longitude ?? toNumber(location.longitude),
            name: out.location?.name || location.name || location.description?.split('\n')[0],
            address: out.location?.address || location.address,
            url: out.location?.url || location.url,
            live: out.location?.live || !!location.live,
            thumbnail: out.location?.thumbnail || thumbnailUrl(location.thumbnail),
        }
    }

    const replyTo = message.replyTo
    if (replyTo && typeof replyTo === 'object' && (replyTo.id || replyTo.body || replyTo._data)) {
        const quote: ParsedQuote = out.quote || {key: null, participant: null, kind: 'text', text: ''}
        quote.key = messageKey(replyTo.id) || quote.key
        quote.participant = replyTo.participant || quote.participant
        const data = replyTo._data
        if (data && typeof data === 'object' && !out.quote) {
            if (typeof data.type === 'string') {
                quote.kind = webjsKind(data.type, data)
                quote.thumbnail = ['image', 'video', 'gif', 'location'].includes(quote.kind) ? webjsThumbnail(data.body) : undefined
                quote.filename = data.filename
            } else {
                const fromProto = quoteFromProto(data, quote.key || '', quote.participant)
                quote.kind = fromProto.kind
                quote.thumbnail = fromProto.thumbnail
                quote.filename = fromProto.filename
                quote.text = fromProto.text
            }
        }
        if (!quote.text && replyTo.body && CAPTION_KINDS.includes(quote.kind)) {
            quote.text = replyTo.body
        }
        out.quote = quote
    }
}

/**
 * Parses one WAHA message into a render-friendly structure. Never throws.
 */
export function parseMessage(message: any): ParsedMessage {
    const data = message?._data
    const engine = detectEngine(data)
    const out = emptyParsed(engine)
    if (!message) {
        return out
    }
    let recognized = false
    try {
        if (engine === 'GOWS') {
            out.senderName = data.Info?.PushName || ''
            recognized = parseProtoContent(data.Message, out)
        } else if (engine === 'NOWEB') {
            out.senderName = data.pushName || data.verifiedBizName || ''
            recognized = (data.message && parseProtoContent(data.message, out)) || parseStub(data, out)
        } else if (engine === 'WEBJS') {
            recognized = parseWebjs(data, message, out)
        }
    } catch (e) {
        console.warn('Failed to parse message', message.id, e)
    }
    try {
        applyTopLevel(message, out, recognized)
    } catch (e) {
        console.warn('Failed to parse message fields', message.id, e)
    }
    if (!out.rawType) {
        out.rawType = data?.type || (message.hasMedia ? 'media' : 'unknown')
    }
    return out
}

export interface MessagePreview {
    icon: string
    /** i18n key for the type label, e.g. "Photo" */
    labelKey: string
    text: string
}

export const KIND_ICONS: Partial<Record<MessageKind, string>> = {
    image: 'pi pi-camera',
    video: 'pi pi-video',
    gif: 'pi pi-video',
    ptv: 'pi pi-video',
    audio: 'pi pi-volume-up',
    voice: 'pi pi-microphone',
    document: 'pi pi-file',
    sticker: 'pi pi-image',
    location: 'pi pi-map-marker',
    contacts: 'pi pi-user',
    poll: 'pi pi-chart-bar',
    event: 'pi pi-calendar',
    'group-invite': 'pi pi-users',
    interactive: 'pi pi-list',
    call: 'pi pi-phone',
    revoked: 'pi pi-ban',
    pending: 'pi pi-clock',
    system: 'pi pi-info-circle',
    unsupported: 'pi pi-question-circle',
}

/**
 * Short one-line description, used in the chat list and in quoted replies
 */
export function messagePreview(parsed: ParsedMessage): MessagePreview {
    const kind = parsed.kind
    const icon = KIND_ICONS[kind] || ''
    const labelKey = kind === 'text' ? '' : `chat.kind.${kind}`
    let text = ''
    switch (kind) {
        case 'text':
        case 'interactive':
            text = parsed.text
            break
        case 'document':
            text = parsed.text || parsed.media?.filename || ''
            break
        case 'voice':
        case 'audio':
        case 'ptv':
            text = parsed.media?.duration ? formatSeconds(parsed.media.duration) : ''
            break
        default:
            text = quoteText(parsed)
    }
    return {icon, labelKey, text}
}

function formatSeconds(seconds: number): string {
    const total = Math.round(seconds)
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
