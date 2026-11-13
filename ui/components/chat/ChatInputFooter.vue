<script setup>
import {useI18n} from "vue-i18n"
import {useToast} from "primevue/usetoast"
import ChatMediaAttachment from "./ChatMediaAttachment.vue"
import MessageQuote from "./message/MessageQuote.vue"
import {formatDuration} from "../../utils/chat/format"

const {t} = useI18n()
const toast = useToast()

const props = defineProps({
  disabled: Boolean,
  /** (text, replyToId?) => Promise */
  sendText: Function,
  /** (type, file, base64, caption?, replyToId?) => Promise */
  sendMedia: Function,
  /** TimelineMessage the user replies to */
  replyTo: Object,
  replySender: String,
  replyColor: String,
})
const emit = defineEmits(['cancel-reply'])

const loading = ref(false)
const text = ref('')
const attachments = ref([]) // { id, type, file, previewUrl, asDocument }
const sendProgress = ref(null) // { current, total }
const textarea = ref(null)
let nextAttachmentId = 1

const hasAttachments = computed(() => attachments.value.length > 0)
const allAudio = computed(() => hasAttachments.value && attachments.value.every((a) => a.type === 'audio' && !a.asDocument))
const captionDisabled = computed(() => allAudio.value)
const canSend = computed(() => !props.disabled && !loading.value && (hasAttachments.value || !!text.value.trim()))
const showMic = computed(() => !hasAttachments.value && !text.value.trim())

const placeholder = computed(() => {
  if (captionDisabled.value) return t('chat.send.placeholder.noAudioCaption')
  if (hasAttachments.value) return t('chat.send.placeholder.caption')
  return t('chat.send.placeholder.message')
})

const replyQuote = computed(() => {
  const item = props.replyTo
  if (!item) return null
  return {
    kind: item.parsed.kind,
    text: item.editedText ?? item.parsed.text ?? '',
    filename: item.parsed.media?.filename,
    thumbnail: item.parsed.media?.thumbnail || item.parsed.location?.thumbnail,
  }
})

watch(() => props.replyTo, (value) => {
  if (value) focus()
})

function focus() {
  nextTick(() => textarea.value?.$el?.focus?.())
}

//
// Attachments
//
const fileInputRef = ref(null)
const pickerType = ref('auto')
const menuRef = ref(null)
const menuItems = computed(() => [
  {label: t('chat.send.attach.image'), icon: 'pi pi-image', command: () => openPicker('image', 'image/*')},
  {label: t('chat.send.attach.video'), icon: 'pi pi-video', command: () => openPicker('video', 'video/*')},
  {label: t('chat.send.attach.audio'), icon: 'pi pi-microphone', command: () => openPicker('audio', 'audio/*')},
  {label: t('chat.send.attach.file'), icon: 'pi pi-file', command: () => openPicker('file', '*/*')},
])

function openPicker(type, accept) {
  pickerType.value = type
  fileInputRef.value.accept = accept
  fileInputRef.value.click()
}

function detectType(file) {
  const mime = file.type || ''
  // WhatsApp images: jpeg / png / webp. Anything else goes as a document.
  if (/^image\/(jpeg|png|webp|gif)$/.test(mime)) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'file'
}

function addFiles(files, preferred = 'auto') {
  for (const file of files || []) {
    const type = preferred === 'auto' ? detectType(file) : preferred
    const previewUrl = ['image', 'video'].includes(type) && /^(image|video)\//.test(file.type) ? URL.createObjectURL(file) : null
    attachments.value.push({id: nextAttachmentId++, type, file, previewUrl, asDocument: false})
  }
  focus()
}

function onFilesChanged(event) {
  const files = [...event.target.files]
  event.target.value = ''
  addFiles(files, pickerType.value)
}

function removeAttachment(index) {
  const attachment = attachments.value[index]
  if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
  attachments.value.splice(index, 1)
}

function clearAttachments() {
  attachments.value.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl))
  attachments.value = []
}

function onPaste(event) {
  const files = [...(event.clipboardData?.files || [])]
  if (files.length) {
    event.preventDefault()
    addFiles(files)
  }
}

function onKeydown(event) {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return
  if (event.shiftKey) return
  event.preventDefault()
  send()
}

//
// Sending
//
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const replyId = () => props.replyTo?.message?.id

async function send() {
  if (!canSend.value) return
  if (hasAttachments.value) {
    await sendAttachments()
  } else {
    await sendTextMessage()
  }
}

async function sendTextMessage() {
  loading.value = true
  try {
    await props.sendText(text.value, replyId())
    text.value = ''
    emit('cancel-reply')
  } catch {
    // the dialog shows the error, keep the text to retry
  } finally {
    loading.value = false
    focus()
  }
}

async function sendAttachments() {
  loading.value = true
  const total = attachments.value.length
  let caption = captionDisabled.value ? '' : text.value
  let reply = replyId()
  try {
    for (let i = 0; i < total; i++) {
      sendProgress.value = {current: i + 1, total}
      const attachment = attachments.value[0]
      const type = attachment.asDocument ? 'file' : attachment.type
      const base64 = await fileToBase64(attachment.file)
      const useCaption = type !== 'audio' && caption ? caption : undefined
      await props.sendMedia(type, attachment.file, base64, useCaption, reply)
      if (useCaption) caption = ''
      reply = undefined
      removeAttachment(0)
    }
    text.value = ''
    emit('cancel-reply')
  } catch {
    // the failed attachment and the ones after it stay in the list
  } finally {
    sendProgress.value = null
    loading.value = false
    focus()
  }
}

//
// Voice recording
//
const recording = ref(false)
const recordSeconds = ref(0)
let recorder = null
let recordStream = null
let recordChunks = []
let recordTimer = null
let recordCancelled = false

const RECORDER_TYPES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    toast.add({severity: 'error', summary: t('chat.send.micError'), detail: t('chat.send.micErrorDetail'), life: 6000})
    return
  }
  try {
    recordStream = await navigator.mediaDevices.getUserMedia({audio: true})
  } catch (e) {
    console.warn('Microphone is not available', e)
    toast.add({severity: 'error', summary: t('chat.send.micError'), detail: t('chat.send.micErrorDetail'), life: 6000})
    return
  }
  const mimeType = RECORDER_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
  recorder = new MediaRecorder(recordStream, mimeType ? {mimeType} : undefined)
  recordChunks = []
  recordCancelled = false
  recorder.ondataavailable = (event) => {
    if (event.data?.size) recordChunks.push(event.data)
  }
  recorder.onstop = onRecordingStopped
  recorder.start(250)
  recording.value = true
  recordSeconds.value = 0
  recordTimer = setInterval(() => recordSeconds.value++, 1000)
}

function releaseRecorder() {
  clearInterval(recordTimer)
  recordTimer = null
  recordStream?.getTracks().forEach((track) => track.stop())
  recordStream = null
  recording.value = false
}

function cancelRecording() {
  recordCancelled = true
  if (recorder?.state !== 'inactive') recorder?.stop()
  else releaseRecorder()
}

function finishRecording() {
  recordCancelled = false
  if (recorder?.state !== 'inactive') recorder?.stop()
}

async function onRecordingStopped() {
  const mimeType = (recorder?.mimeType || recordChunks[0]?.type || 'audio/webm').split(';')[0]
  releaseRecorder()
  if (recordCancelled || !recordChunks.length) return
  const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm'
  const file = new File(recordChunks, `voice-${Date.now()}.${extension}`, {type: mimeType})
  recordChunks = []
  loading.value = true
  try {
    await props.sendMedia('audio', file, await fileToBase64(file), undefined, replyId())
    emit('cancel-reply')
  } catch {
    // the dialog shows the error
  } finally {
    loading.value = false
  }
}

onBeforeUnmount(() => {
  if (recording.value) cancelRecording()
  clearAttachments()
})

defineExpose({addFiles, focus})
</script>

<template>
  <div class="chat-footer">
    <!-- Reply -->
    <div v-if="replyQuote" class="reply-bar">
      <MessageQuote :quote="replyQuote" :sender="replySender" :color="replyColor" class="reply-quote"/>
      <Button
          icon="pi pi-times"
          text
          rounded
          size="small"
          v-tooltip.top="t('chat.send.cancelReply')"
          :aria-label="t('chat.send.cancelReply')"
          @click="emit('cancel-reply')"
      />
    </div>

    <!-- Attachment previews -->
    <div v-if="hasAttachments" class="attachments">
      <ChatMediaAttachment
          v-for="(attachment, index) in attachments"
          :key="attachment.id"
          :attachment="attachment"
          :disabled="loading"
          @remove="removeAttachment(index)"
          @toggle-document="attachment.asDocument = !attachment.asDocument"
      />
    </div>

    <!-- Recording -->
    <div v-if="recording" class="input-row">
      <Button
          icon="pi pi-trash"
          text
          rounded
          severity="danger"
          v-tooltip.top="t('chat.send.cancelRecording')"
          :aria-label="t('chat.send.cancelRecording')"
          @click="cancelRecording"
      />
      <div class="recording">
        <span class="recording-dot"></span>
        <span class="recording-time">{{ formatDuration(recordSeconds) }}</span>
        <span class="recording-label">{{ t('chat.send.recording') }}</span>
      </div>
      <Button
          icon="pi pi-send"
          rounded
          severity="success"
          v-tooltip.top="t('chat.send.stopAndSend')"
          :aria-label="t('chat.send.stopAndSend')"
          @click="finishRecording"
      />
    </div>

    <div v-else class="input-row">
      <Button
          icon="pi pi-paperclip"
          text
          rounded
          :disabled="disabled || loading"
          v-tooltip.top="t('chat.send.attach.button')"
          :aria-label="t('chat.send.attach.button')"
          @click="menuRef.toggle($event)"
      />
      <Menu ref="menuRef" :model="menuItems" popup class="chat-popup"/>
      <input ref="fileInputRef" type="file" multiple class="hidden-input" @change="onFilesChanged"/>

      <Textarea
          ref="textarea"
          v-model="text"
          rows="1"
          autoResize
          dir="auto"
          class="message-input"
          :disabled="captionDisabled || disabled"
          :placeholder="placeholder"
          @keydown="onKeydown"
          @paste="onPaste"
      />

      <div class="send-area">
        <Button
            v-if="showMic"
            icon="pi pi-microphone"
            rounded
            text
            :disabled="disabled || loading"
            :loading="loading"
            v-tooltip.top="t('chat.send.record')"
            :aria-label="t('chat.send.record')"
            @click="startRecording"
        />
        <Button
            v-else
            icon="pi pi-send"
            rounded
            severity="success"
            :disabled="!canSend"
            :loading="loading"
            v-tooltip.top="t('chat.send.hint')"
            :aria-label="t('chat.send.send')"
            @click="send"
        />
        <small v-if="sendProgress && sendProgress.total > 1" class="progress">
          {{ t('chat.send.progress', {current: sendProgress.current, total: sendProgress.total}) }}
        </small>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.chat-footer {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--surface-border);
  background: var(--surface-card);
}

.reply-bar {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.reply-quote {
  flex: 1;
}

.attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  max-height: 9.5rem;
  overflow-y: auto;
}

.input-row {
  display: flex;
  align-items: flex-end;
  gap: 0.4rem;
}

.hidden-input {
  display: none;
}

.message-input {
  flex: 1;
  min-height: 2.5rem;
  max-height: 9rem;
  overflow-y: auto !important;
  resize: none;
  border-radius: 1.25rem;
  padding: 0.6rem 0.9rem;
  line-height: 1.35;
}

.send-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.progress {
  font-size: 0.7rem;
  white-space: nowrap;
  color: var(--text-color-secondary);
}

.recording {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  height: 2.5rem;
  padding: 0 0.9rem;
  border-radius: 1.25rem;
  background: var(--surface-ground);
}

.recording-dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 50%;
  background: var(--red-500, #ef4444);
  animation: pulse 1s ease-in-out infinite;
}

.recording-time {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.recording-label {
  color: var(--text-color-secondary);
  font-size: 0.85rem;
}

@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}
</style>
