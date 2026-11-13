<script setup>
import {useI18n} from "vue-i18n";
import ContactChip from "../sessions/ContactChip.vue";
import MessageAck from "./MessageAck.vue";
import ChatLabels from "./ChatLabels.vue";
import {messagePreview} from "../../utils/chat/messageParser";
import {parseCached, timestampMs} from "../../utils/chat/timeline";
import {useMessageLabels} from "../../composables/chat/useMessageLabels";

const props = defineProps({
  id: String,
  name: String,
  picture: String,
  message: Object,
  serverId: String,
  sessionName: String,
})
const {t, locale} = useI18n()
const {kindLabel} = useMessageLabels()

const LIMIT = 60
const preview = computed(() => {
  if (!props.message) return null
  const parsed = parseCached(props.message)
  if (['hidden', 'edit'].includes(parsed.kind)) return null
  if (parsed.kind === 'reaction') {
    return {icon: '', label: '', text: t('chat.preview.reacted', {emoji: parsed.reaction?.emoji || ''})}
  }
  const value = messagePreview(parsed)
  const text = value.text.replace(/\s+/g, ' ').trim()
  return {
    icon: value.icon,
    label: value.labelKind && (!text || ['voice', 'audio', 'ptv'].includes(parsed.kind)) ? kindLabel(value.labelKind) : '',
    text: text.length > LIMIT ? text.slice(0, LIMIT) + '…' : text,
  }
})

const time = computed(() => {
  const ms = timestampMs(props.message?.timestamp)
  if (!ms) return ''
  const date = new Date(ms)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  const options = sameDay
      ? {hour: '2-digit', minute: '2-digit'}
      : {day: 'numeric', month: 'short', year: date.getFullYear() === now.getFullYear() ? undefined : '2-digit'}
  return new Intl.DateTimeFormat(locale.value || undefined, options).format(date)
})
</script>

<template>
  <div class="chat-preview">
    <div class="flex align-items-start justify-content-between gap-2">
      <ContactChip
          :id="props.id"
          :name="props.name"
          :image="props.picture"
      />
      <span v-if="time" class="preview-time">{{ time }}</span>
    </div>
    <div v-if="preview" class="preview-line">
      <MessageAck v-if="message.fromMe" :ack="message.ack" class="preview-ack"/>
      <i v-if="preview.icon" :class="preview.icon" class="preview-icon"></i>
      <span v-if="preview.label" class="preview-label">{{ preview.label }}</span>
      <span class="preview-text" dir="auto">{{ preview.text }}</span>
    </div>
    <ChatLabels
        :serverId="serverId"
        :sessionName="sessionName"
        :chatId="props.id"
        class="mt-2"
    />
  </div>
</template>

<style scoped lang="scss">
.chat-preview {
  min-width: 0;
}

.preview-time {
  flex-shrink: 0;
  margin-top: 0.4rem;
  font-size: 0.72rem;
  color: var(--text-color-secondary);
}

.preview-line {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin-top: 0.35rem;
  min-width: 0;
  font-size: 0.85rem;
  color: var(--text-color-secondary);
}

.preview-ack {
  flex-shrink: 0;
  font-size: 0.75rem;
}

.preview-icon {
  flex-shrink: 0;
  font-size: 0.8rem;
}

.preview-label {
  flex-shrink: 0;
}

.preview-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
