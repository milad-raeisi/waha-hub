<script setup>
// TEMPORARY visual test harness for the chat UI - delete after verification.
import {useI18n} from "vue-i18n";

definePageMeta({layout: false})

const route = useRoute()
const {locale} = useI18n()
if (route.query.lang) locale.value = String(route.query.lang)

const store = useServerStore()
const NOW = Math.floor(Date.now() / 1000)
const DAY = 86400

function canvasUrl(w, h, hue, label, type = 'image/jpeg', quality = 0.8) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createLinearGradient(0, 0, w, h)
  gradient.addColorStop(0, `hsl(${hue}, 70%, 55%)`)
  gradient.addColorStop(1, `hsl(${hue + 60}, 70%, 35%)`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.font = `bold ${Math.round(h / 8)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText(label, w / 2, h / 2)
  return canvas.toDataURL(type, quality)
}

const b64 = (dataUrl) => dataUrl.split(',')[1]

function wavUrl(seconds = 3) {
  const rate = 8000
  const n = rate * seconds
  const buffer = new ArrayBuffer(44 + n * 2)
  const view = new DataView(buffer)
  const str = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  str(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  str(36, 'data'); view.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    const envelope = Math.abs(Math.sin(i / rate * 3))
    view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 440 * i / rate) * 0.3 * 32767 * envelope, true)
  }
  let binary = ''
  new Uint8Array(buffer).forEach((b) => binary += String.fromCharCode(b))
  return `data:audio/wav;base64,${btoa(binary)}`
}

const thumbA = b64(canvasUrl(64, 48, 200, '', 'image/jpeg', 0.5))
const thumbMap = b64(canvasUrl(96, 64, 100, '📍', 'image/jpeg', 0.5))
const thumbVideo = b64(canvasUrl(64, 36, 300, '▶', 'image/jpeg', 0.5))
const thumbPdf = b64(canvasUrl(80, 60, 0, 'PDF', 'image/jpeg', 0.5))
const waveform = {type: 'Buffer', data: btoa(String.fromCharCode(...Array.from({length: 64}, (_, i) => Math.round(50 + 45 * Math.sin(i / 2.3)))))}

const media = {}
const ALI = '972501111111@c.us'
const GROUP = '120363000000000001@g.us'
const SUP = '972503333333@c.us'

// NOWEB message helper
let seq = 0
function noweb(chat, fromMe, ts, message, extra = {}) {
  const key = `NW${++seq}`
  return {
    id: `${fromMe}_${chat}_${key}`, timestamp: ts, from: fromMe ? '111@c.us' : chat, to: fromMe ? chat : '111@c.us',
    fromMe, body: message?.conversation || message?.extendedTextMessage?.text || '', hasMedia: !!(message?.imageMessage || message?.audioMessage || message?.documentMessage || message?.documentWithCaptionMessage || message?.stickerMessage || message?.videoMessage),
    ack: fromMe ? 3 : 0, ...extra,
    _data: {key: {id: key, remoteJid: chat, fromMe}, message, pushName: fromMe ? 'Me' : 'علی رضایی', messageTimestamp: ts, ...(extra._extra || {})},
  }
}
const k = (m) => m.id.split('_')[2]

const y = NOW - DAY
const old = NOW - 4 * DAY
const nw = []
nw.push(noweb(ALI, false, old, {conversation: 'سلام! حالت چطوره؟ این یک پیام *فارسی* با _فرمت_ و ~خط‌خورده~ است.'}))
const link = noweb(ALI, true, old + 60, {extendedTextMessage: {text: 'Hi Ali! Check https://github.com/devlikeapro/waha it is *great*', matchedText: 'https://github.com/devlikeapro/waha', title: 'WAHA - WhatsApp HTTP API', description: 'Self-hosted WhatsApp HTTP API you can run in a click!', jpegThumbnail: {type: 'Buffer', data: thumbA}}})
nw.push(link)
const img = noweb(ALI, false, y, {imageMessage: {mimetype: 'image/jpeg', caption: 'عکس از سفر 🏔️', width: 1280, height: 960, fileLength: 345678, jpegThumbnail: {type: 'Buffer', data: thumbA}}})
nw.push(img)
media[img.id] = {url: canvasUrl(1280, 960, 200, 'Mountain 🏔️'), mimetype: 'image/jpeg'}
const voice = noweb(ALI, false, y + 30, {audioMessage: {ptt: true, seconds: 3, mimetype: 'audio/ogg; codecs=opus', waveform}})
nw.push(voice)
media[voice.id] = {url: wavUrl(3), mimetype: 'audio/wav'}
const doc = noweb(ALI, true, y + 120, {documentWithCaptionMessage: {message: {documentMessage: {fileName: 'گزارش-مالی-۱۴۰۳.pdf', mimetype: 'application/pdf', pageCount: 12, fileLength: 2457600, caption: 'گزارش ماهانه', jpegThumbnail: thumbPdf}}}})
nw.push(doc)
media[doc.id] = {url: 'data:text/plain;base64,' + btoa('fake pdf'), mimetype: 'text/plain', filename: 'report.pdf'}
nw.push(noweb(ALI, false, y + 200, {locationMessage: {degreesLatitude: 35.6997, degreesLongitude: 51.3380, name: 'میدان آزادی', address: 'تهران، ایران', jpegThumbnail: thumbMap}}))
nw.push(noweb(ALI, false, y + 260, {contactMessage: {displayName: 'Jane Doe', vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Jane Doe\nORG:Acme Inc.\nitem1.TEL;waid=15550001111:+1 555 000 1111\nEMAIL:jane@example.com\nEND:VCARD'}}))
nw.push(noweb(ALI, true, y + 300, {pollCreationMessageV3: {name: 'ناهار کجا بریم؟', options: [{optionName: 'پیتزا 🍕'}, {optionName: 'کباب'}, {optionName: 'Sushi'}], selectableOptionsCount: 1}}))
nw.push(noweb(ALI, false, y + 320, {reactionMessage: {key: {id: k(link)}, text: '❤️'}}))
nw.push(noweb(ALI, true, y + 330, {reactionMessage: {key: {id: k(img)}, text: '😂'}}))
nw.push(noweb(ALI, false, NOW - 3600, {extendedTextMessage: {text: 'ممنون، دریافت شد 👍', contextInfo: {stanzaId: k(doc), participant: '111@s.whatsapp.net', quotedMessage: {documentMessage: {fileName: 'گزارش-مالی-۱۴۰۳.pdf'}}}}}))
nw.push(noweb(ALI, false, NOW - 3500, {conversation: '😂😂'}))
const edited = noweb(ALI, true, NOW - 3400, {conversation: 'This is the original text'})
nw.push(edited)
nw.push(noweb(ALI, true, NOW - 3390, {protocolMessage: {type: 14, key: {id: k(edited)}, editedMessage: {conversation: 'This text was edited ✏️'}}}))
const toDelete = noweb(ALI, false, NOW - 3300, {conversation: 'secret'})
nw.push(toDelete)
nw.push(noweb(ALI, false, NOW - 3290, {protocolMessage: {type: 0, key: {id: k(toDelete)}}}))
const sticker = noweb(ALI, false, NOW - 3000, {stickerMessage: {mimetype: 'image/webp', isAnimated: false}})
nw.push(sticker)
media[sticker.id] = {url: canvasUrl(256, 256, 40, '😎', 'image/png'), mimetype: 'image/png'}
nw.push(noweb(ALI, false, NOW - 2900, {videoMessage: {mimetype: 'video/mp4', seconds: 42, width: 1280, height: 720, fileLength: 7340032, jpegThumbnail: thumbVideo, caption: 'Video with caption'}}))
nw.push(noweb(ALI, false, NOW - 2800, {extendedTextMessage: {text: 'Forwarded text message', contextInfo: {isForwarded: true, forwardingScore: 5}}}))
nw.push(noweb(ALI, false, NOW - 2700, {conversation: ('این یک متن طولانی فارسی است که برای آزمایش «ادامه مطلب» نوشته شده. '.repeat(30)).trim()}))
nw.push(noweb(ALI, true, NOW - 2600, {conversation: 'Code: `npm install` and block:\n```const x = 1;\nconsole.log(x)```\n> quoted line'}))
const song = noweb(ALI, true, NOW - 2500, {audioMessage: {ptt: false, seconds: 3, mimetype: 'audio/mpeg'}})
nw.push(song)
media[song.id] = {url: wavUrl(3), mimetype: 'audio/wav', filename: 'song.mp3'}
nw.push(noweb(ALI, false, NOW - 2400, {viewOnceMessageV2: {message: {imageMessage: {mimetype: 'image/jpeg', viewOnce: true}}}}))
nw.push({id: `false_${ALI}_STUB1`, timestamp: NOW - 2300, from: ALI, fromMe: false, body: '', hasMedia: false, _data: {key: {id: 'STUB1'}, message: null, messageStubType: 2}})
nw.push(noweb(ALI, false, NOW - 120, {conversation: 'Mixed: سلام Hello خوبی؟ 👋'}))
nw.push(noweb(ALI, true, NOW - 60, {conversation: 'پیام ارسالی من با تیک دوتایی'}, {ack: 2}))

// GOWS group
function gows(fromMe, participant, name, ts, Message, extra = {}) {
  const key = `GW${++seq}`
  return {
    id: `${fromMe}_${GROUP}_${key}${participant ? '_' + participant : ''}`, timestamp: ts, from: fromMe ? '111@c.us' : GROUP,
    participant: fromMe ? undefined : participant, fromMe, body: Message?.conversation || '', hasMedia: !!Message?.imageMessage, ack: fromMe ? 3 : 0, ...extra,
    _data: {Info: {ID: key, PushName: name, IsFromMe: fromMe}, Message},
  }
}
const SARA = '972504444444@c.us'
const REZA = '972505555555@c.us'
const NIMA = '972506666666@c.us'
const gw = []
gw.push(gows(false, SARA, 'Sara', y, {protocolMessage: {type: 'EPHEMERAL_SETTING'}}))
const saraMsg = gows(false, SARA, 'Sara', y + 10, {conversation: 'Hey team, the release is ready for review 🚀'})
gw.push(saraMsg)
gw.push(gows(false, SARA, 'Sara', y + 20, {conversation: 'Please check the changelog.'}))
gw.push(gows(false, REZA, 'رضا', y + 100, {extendedTextMessage: {text: 'عالیه! الان بررسی می‌کنم', contextInfo: {stanzaID: k(saraMsg), participant: SARA, quotedMessage: {conversation: 'Hey team, the release is ready for review 🚀'}}}}))
const gimg = gows(false, REZA, 'رضا', y + 160, {imageMessage: {mimetype: 'image/jpeg', width: 600, height: 900, JPEGThumbnail: thumbA}})
gw.push(gimg)
media[gimg.id] = {url: canvasUrl(600, 900, 260, 'Screenshot'), mimetype: 'image/jpeg'}
gw.push(gows(false, REZA, 'رضا', y + 170, {reactionMessage: {key: {ID: k(saraMsg)}, text: '👍'}}))
gw.push(gows(false, NIMA, 'Nima', y + 180, {reactionMessage: {key: {ID: k(saraMsg)}, text: '👍'}}))
gw.push(gows(true, null, 'Me', NOW - 600, {conversation: 'Merged ✅ thanks @972504444444'}))
gw.push(gows(false, NIMA, 'Nima', NOW - 300, {conversation: '@972505555555 لطفا تست‌ها رو هم اجرا کن'}))

// WEBJS chat
function webjs(fromMe, ts, d, extra = {}) {
  const key = `WJ${++seq}`
  return {
    id: `${fromMe}_${SUP}_${key}`, timestamp: ts, from: fromMe ? '111@c.us' : SUP, fromMe, body: extra.body ?? d.body ?? '',
    hasMedia: !!extra.hasMedia, ack: fromMe ? 1 : 0, ...extra, _data: {id: {_serialized: key}, notifyName: 'Support Bot', ...d},
  }
}
const wj = []
wj.push(webjs(false, old, {type: 'e2e_notification', subtype: 'encrypt'}))
const wtext = webjs(false, old + 10, {type: 'chat', body: 'Welcome to support! How can we help? 😊'})
wj.push(wtext)
const wptt = webjs(false, old + 20, {type: 'ptt', duration: '3', mimetype: 'audio/ogg; codecs=opus'}, {hasMedia: true, body: ''})
wj.push(wptt)
media[wptt.id] = {url: wavUrl(3), mimetype: 'audio/wav'}
const wimg = webjs(false, old + 30, {type: 'image', body: thumbA, width: 800, height: 800, mimetype: 'image/jpeg'}, {hasMedia: true, body: 'Product photo'})
wj.push(wimg)
media[wimg.id] = {url: canvasUrl(800, 800, 160, 'Product'), mimetype: 'image/jpeg'}
wj.push(webjs(false, old + 40, {type: 'call_log', isVideoCall: true, callOutcome: 'Missed'}))
wj.push(webjs(false, old + 50, {type: 'revoked'}))
wj.push(webjs(false, old + 60, {type: 'multi_vcard', vcardList: [{displayName: 'Sales', vcard: 'BEGIN:VCARD\nFN:Sales Team\nTEL;waid=15551112222:+1 555 111 2222\nEND:VCARD'}, {displayName: 'Ops', vcard: 'BEGIN:VCARD\nFN:Ops Team\nTEL:+1 555 333 4444\nEND:VCARD'}]}))
wj.push(webjs(false, old + 70, {type: 'location', lat: 48.8584, lng: 2.2945, loc: 'Eiffel Tower\nParis, France', body: thumbMap}, {body: thumbMap}))
wj.push(webjs(true, old + 80, {type: 'chat', body: 'I need help with my order', quotedMsg: {type: 'chat', body: 'Welcome to support! How can we help? 😊'}, quotedStanzaID: wtext._data.id._serialized, quotedParticipant: SUP}))
const wdoc = webjs(false, old + 90, {type: 'document', filename: 'invoice-2026.xlsx', size: 48211, mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}, {hasMedia: true, body: ''})
wj.push(wdoc)
wj.push(webjs(false, old + 100, {type: 'gp2', subtype: 'add', recipients: ['972507777777@c.us']}))
wj.push(webjs(false, old + 110, {type: 'unknown_type_xyz'}))

const chats = {[ALI]: nw, [GROUP]: gw, [SUP]: wj}
const names = {[ALI]: 'علی رضایی (NOWEB)', [GROUP]: 'تیم توسعه (GOWS)', [SUP]: 'Support (WEBJS)'}
const all = () => Object.values(chats).flat()

const server = {id: 'mock', name: 'Mock server', connected: true, connection: {url: 'http://127.0.0.1:9', key: 'mock-key'}}
store.getServer = () => server
store.getChatsOverview = async () => Object.keys(chats).map((id) => ({id, name: names[id], picture: null, lastMessage: chats[id][chats[id].length - 1]}))
store.getChatsMessages = async (s, n, chatId, limit, offset) => {
  const list = [...(chats[chatId] || [])].sort((a, b) => b.timestamp - a.timestamp)
  return list.slice(offset, offset + limit)
}
store.getChatMessage = async (s, n, id) => {
  await new Promise((r) => setTimeout(r, 400))
  const message = all().find((m) => m.id === id)
  return {...message, media: media[id] || {error: {message: 'Media file was not found on the server'}}}
}
store.getProfilePicture = async () => ({profilePictureURL: null})
store.getChatLabels = async () => []
store.getLabels = async () => []
store.findLIDByPhoneNumber = async () => ({lid: null})
store.findPNByLid = async () => ({pn: null})
store.getMyGroupParticipantTag = async () => ({tag: 'Developer'})
store.getGroupParticipantTag = async (s, n, g, p) => ({tag: p === SARA ? 'Team lead' : null})
store.readChatMessages = async () => {
  window.__readCalls = (window.__readCalls || 0) + 1
}
function pushSent(chatId, data) {
  const message = noweb(chatId, true, Math.floor(Date.now() / 1000), data.message, {ack: 1})
  if (data.media) media[message.id] = data.media
  chats[chatId].push(message)
}
store.sendText = async (s, n, chatId, text, replyTo) => {
  window.__lastSend = {text, replyTo}
  pushSent(chatId, {message: {conversation: text}})
}
store.sendImage = async (s, n, chatId, file, caption, replyTo) => {
  window.__lastSend = {type: 'image', caption, replyTo}
  pushSent(chatId, {message: {imageMessage: {mimetype: file.mimetype, caption}}, media: {url: `data:${file.mimetype};base64,${file.data}`, mimetype: file.mimetype}})
}
store.sendVoice = async (s, n, chatId, file, replyTo) => {
  window.__lastSend = {type: 'voice', mimetype: file.mimetype, size: file.data.length, replyTo}
  pushSent(chatId, {message: {audioMessage: {ptt: true, seconds: 2, mimetype: file.mimetype}}, media: {url: `data:${file.mimetype};base64,${file.data}`, mimetype: file.mimetype}})
}
store.sendFile = async (s, n, chatId, file, caption, replyTo) => {
  window.__lastSend = {type: 'file', filename: file.filename, caption, replyTo}
  pushSent(chatId, {message: {documentMessage: {fileName: file.filename, mimetype: file.mimetype, caption}}})
}
store.sendVideo = store.sendFile

const visible = ref(false)
onMounted(() => setTimeout(() => visible.value = true, 300))
const session = ref({name: 'default', status: 'WORKING', server, me: {id: '111@c.us', pushName: 'Me'}})
</script>

<template>
  <div style="padding: 1rem">
    <Button label="Open chat" @click="visible = true"/>
    <SessionChatDialog v-model:visible="visible" v-model:session="session"/>
  </div>
</template>
