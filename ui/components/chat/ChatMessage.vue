<script setup>
import {useI18n} from "vue-i18n";
import MessageAck from "./MessageAck.vue";
import MessageText from "./message/MessageText.vue";
import MessageQuote from "./message/MessageQuote.vue";
import MessageVisualMedia from "./message/MessageVisualMedia.vue";
import MessageAudio from "./message/MessageAudio.vue";
import MessageDocument from "./message/MessageDocument.vue";
import MessageStructured from "./message/MessageStructured.vue";
import {useI18nDate} from "../../composables/useI18nDate";
import {formatDuration, formatJid, senderColor, textDirection} from "../../utils/chat/format";
import {KIND_ICONS, VISUAL_MEDIA_KINDS} from "../../utils/chat/messageParser";
import {useMessageLabels} from "../../composables/chat/useMessageLabels";

const props = defineProps({
  /** TimelineMessage from utils/chat/timeline */
  item: Object,
  serverId: String,
  sessionName: String,
  isGroup: Boolean,
  participantTag: String,
  myTag: String,
  editMyTag: Function,
  /** (jid) => display name or null */
  nameOf: Function,
  /** number -> name, for @mentions */
  mentions: Object,
  highlighted: Boolean,
})
const emit = defineEmits(['menu', 'jump'])
const {t, locale} = useI18n()
const {formatChatTimestamp} = useI18nDate()
const {systemText: translateSystem} = useMessageLabels()

const message = computed(() => props.item.message)
const parsed = computed(() => props.item.parsed)
const kind = computed(() => props.item.revoked ? 'revoked' : parsed.value.kind)
const fromMe = computed(() => !!message.value.fromMe)

//
// Sender
//
const senderJid = computed(() => message.value.participant || message.value.author || message.value.from)
const showSender = computed(() => props.isGroup && !fromMe.value && props.item.firstInGroup)
const senderName = computed(() => parsed.value.senderName || props.nameOf?.(senderJid.value) || formatJid(senderJid.value))
const senderPhone = computed(() => {
  const phone = formatJid(senderJid.value)
  return phone && phone !== senderName.value ? phone : ''
})
const nameColor = computed(() => senderColor(props.item.senderId))

const quoteSender = computed(() => {
  const participant = parsed.value.quote?.participant
  if (!participant) return props.isGroup ? '' : (fromMe.value ? t('chat.message.you') : '')
  return props.nameOf?.(participant) || formatJid(participant)
})
const quoteColor = computed(() => senderColor(parsed.value.quote?.participant))

//
// Content
//
const isVisual = computed(() => VISUAL_MEDIA_KINDS.includes(kind.value))
const isAudio = computed(() => ['voice', 'audio'].includes(kind.value))
const isStructured = computed(() => ['location', 'contacts', 'poll', 'event', 'group-invite', 'interactive'].includes(kind.value))
const isSticker = computed(() => kind.value === 'sticker')
const edited = computed(() => parsed.value.edited || props.item.editedText !== null)

const displayText = computed(() => {
  if (['revoked', 'pending', 'interactive', 'unsupported'].includes(kind.value)) return ''
  if (isStructured.value || isAudio.value || isSticker.value) return ''
  return props.item.editedText ?? parsed.value.text ?? ''
})

const linkPreview = computed(() => {
  const preview = parsed.value.linkPreview
  if (!preview || kind.value !== 'text' || !preview.url) return null
  const href = /^https?:\/\//i.test(preview.url) ? preview.url : `https://${preview.url}`
  let domain = ''
  try {
    domain = new URL(href).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
  return {...preview, href, domain}
})

const jumbo = computed(() => kind.value === 'text' && !parsed.value.quote && !linkPreview.value && !parsed.value.forwarded)

//
// Meta: time, edited, ack
//
const time = computed(() => {
  const value = Number(message.value.timestamp)
  if (!value) return ''
  const date = new Date(value < 1e12 ? value * 1000 : value)
  return new Intl.DateTimeFormat(locale.value || undefined, {hour: '2-digit', minute: '2-digit'}).format(date)
})
const fullDate = computed(() => formatChatTimestamp(message.value.timestamp))

// "overlay" - on top of media, "inline" - at the end of the text, "block" - own line
const metaMode = computed(() => {
  if (isVisual.value && !displayText.value && !parsed.value.media?.viewOnce && !['revoked'].includes(kind.value)) return 'overlay'
  if (displayText.value) return 'inline'
  return 'block'
})
const spacer = computed(() => {
  if (metaMode.value !== 'inline') return 0
  return 3.4 + (fromMe.value ? 1.3 : 0) + (edited.value ? 3.6 : 0)
})
// The time sits where the last line of the text ends: the left side for Persian / Arabic text in an LTR layout
const layoutDir = computed(() => ['fa', 'ar'].includes(locale.value) ? 'rtl' : 'ltr')
const metaFlipped = computed(() => metaMode.value === 'inline' && textDirection(displayText.value) !== layoutDir.value)

//
// Centered notices
//
const systemText = computed(() => {
  if (kind.value === 'call') {
    const call = parsed.value.call || {}
    const label = call.missed
        ? (call.video ? t('chat.message.callMissedVideo') : t('chat.message.callMissedVoice'))
        : (call.video ? t('chat.message.callVideo') : t('chat.message.callVoice'))
    const duration = call.duration ? ` (${formatDuration(call.duration)})` : ''
    return label + duration
  }
  const system = parsed.value.system || {key: 'generic', params: {}}
  const params = {...system.params}
  if (!params.users) params.users = senderName.value
  if (!params.type) params.type = parsed.value.rawType
  return translateSystem(system.key, params)
})
const systemIcon = computed(() => {
  if (kind.value === 'call') return parsed.value.call?.video ? 'pi pi-video' : 'pi pi-phone'
  if (parsed.value.system?.key === 'e2e') return 'pi pi-lock'
  if (parsed.value.system?.key === 'disappearing') return 'pi pi-clock'
  return KIND_ICONS.system
})

function openMenu(event) {
  emit('menu', event, props.item)
}
</script>

<template>
  <div
      class="msg-row"
      :class="{ out: fromMe, in: !fromMe, center: item.centered, grouped: !item.firstInGroup, highlighted }"
      :data-key="item.key"
  >
    <!-- Centered notice: system events, calls -->
    <div v-if="item.centered" class="notice" :class="{ missed: kind === 'call' && parsed.call?.missed }">
      <i :class="systemIcon"></i>
      <span dir="auto">{{ systemText }}</span>
      <span class="notice-time" v-tooltip.top="fullDate">{{ time }}</span>
    </div>

    <template v-else>
      <div
          class="bubble"
          :class="{ first: item.firstInGroup, sticker: isSticker && !parsed.quote, visual: isVisual }"
          @contextmenu.prevent="openMenu"
      >
        <button type="button" class="menu-trigger" :aria-label="t('chat.message.actions.title')" @click="openMenu">
          <i class="pi pi-angle-down"></i>
        </button>

        <!-- Sender in groups -->
        <div v-if="showSender" class="sender">
          <span class="sender-name" :style="{ color: nameColor }" dir="auto">{{ senderName }}</span>
          <span v-if="senderPhone" class="sender-phone" dir="ltr">{{ senderPhone }}</span>
          <span v-if="participantTag" class="sender-tag" v-tooltip.top="t('chat.tags.memberTag')">{{ participantTag }}</span>
        </div>
        <!-- My member tag in groups -->
        <div v-if="fromMe && editMyTag && item.firstInGroup" class="sender">
          <a href="#" class="sender-tag" v-tooltip.top="t('chat.tags.clickToEdit')" @click.prevent="editMyTag">
            <template v-if="myTag">{{ myTag }}</template>
            <template v-else><i class="pi pi-tag"></i> {{ t('chat.tags.add') }}</template>
          </a>
        </div>

        <div v-if="parsed.forwarded && kind !== 'revoked'" class="forwarded">
          <i class="pi pi-share-alt"></i>
          {{ parsed.forwardedMany ? t('chat.message.forwardedMany') : t('chat.message.forwarded') }}
        </div>

        <MessageQuote
            v-if="parsed.quote && kind !== 'revoked'"
            :quote="parsed.quote"
            :sender="quoteSender"
            :color="quoteColor"
            clickable
            class="mb-1"
            @click="emit('jump', parsed.quote.key)"
        />

        <!-- Content -->
        <div v-if="kind === 'revoked'" class="muted">
          <i class="pi pi-ban"></i> {{ t('chat.message.deleted') }}
        </div>
        <div v-else-if="kind === 'pending'" class="muted">
          <i class="pi pi-clock"></i> {{ t('chat.message.pending') }}
        </div>
        <div v-else-if="kind === 'unsupported'" class="muted">
          <i class="pi pi-question-circle"></i> {{ t('chat.message.unsupported', {type: parsed.rawType || '?'}) }}
        </div>
        <template v-else>
          <MessageVisualMedia
              v-if="isVisual"
              :kind="kind"
              :media="parsed.media"
              :message="message"
              :serverId="serverId"
              :sessionName="sessionName"
          />
          <MessageAudio
              v-else-if="isAudio"
              :kind="kind"
              :media="parsed.media"
              :message="message"
              :serverId="serverId"
              :sessionName="sessionName"
          />
          <MessageDocument
              v-else-if="kind === 'document'"
              :media="parsed.media"
              :message="message"
              :serverId="serverId"
              :sessionName="sessionName"
          />
          <MessageStructured v-else-if="isStructured" :parsed="parsed"/>

          <a
              v-if="linkPreview"
              class="link-preview"
              :href="linkPreview.href"
              target="_blank"
              rel="noopener noreferrer"
          >
            <img v-if="linkPreview.thumbnail" :src="linkPreview.thumbnail" alt="" class="link-thumb"/>
            <div class="link-info">
              <div v-if="linkPreview.title" class="link-title" dir="auto">{{ linkPreview.title }}</div>
              <div v-if="linkPreview.description" class="link-description" dir="auto">{{ linkPreview.description }}</div>
              <div class="link-domain">{{ linkPreview.domain }}</div>
            </div>
          </a>

          <MessageText
              v-if="displayText"
              :text="displayText"
              :allowJumbo="jumbo"
              :mentions="mentions"
              :spacer="spacer"
              :class="{ 'mt-1': kind !== 'text' }"
          />
        </template>

        <!-- Time, edited, ack -->
        <div class="meta" :class="[`meta-${metaMode}`, { 'meta-flipped': metaFlipped }]">
          <span v-if="edited" class="edited">{{ t('chat.message.edited') }}</span>
          <span v-tooltip.top="fullDate">{{ time }}</span>
          <MessageAck v-if="fromMe" :ack="message.ack" class="ack"/>
        </div>
      </div>

      <div v-if="item.reactions.length" class="reactions">
        <span
            v-for="reaction in item.reactions"
            :key="reaction.emoji"
            class="reaction"
            :class="{ mine: reaction.mine }"
            v-tooltip.top="reaction.senders.map((sender) => sender === 'me' ? t('chat.message.you') : (nameOf?.(sender) || formatJid(sender))).join(', ')"
        >
          {{ reaction.emoji }}<span v-if="reaction.count > 1" class="reaction-count">{{ reaction.count }}</span>
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.msg-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 0 1.25rem;
  margin-top: 0.5rem;

  &.grouped {
    margin-top: 0.15rem;
  }

  &.out {
    align-items: flex-end;
  }

  &.center {
    align-items: center;
    margin: 0.6rem 0;
  }

  &.highlighted .bubble {
    animation: highlight 1.6s ease-out;
  }
}

@keyframes highlight {
  0%, 40% {
    box-shadow: 0 0 0 3px var(--primary-color);
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}

.bubble {
  --bubble-bg: var(--surface-card);
  --bubble-border: var(--surface-border);
  position: relative;
  max-width: min(75%, 520px);
  min-width: 5.5rem;
  padding: 0.35rem 0.55rem 0.3rem;
  border-radius: 10px;
  background: var(--bubble-bg);
  color: var(--text-color);
  box-shadow: 0 1px 0.5px rgba(0, 0, 0, 0.13), 0 0 0 1px var(--bubble-border);
  overflow-wrap: anywhere;

  // Incoming: neutral card. Outgoing: tinted with the theme primary color (works for every theme, light or dark)
  .out & {
    --bubble-bg: var(--highlight-bg);
    --bubble-bg: color-mix(in srgb, var(--primary-color) 26%, var(--surface-card));
    --bubble-border: color-mix(in srgb, var(--primary-color) 30%, transparent);
  }

  // Tail on the first message of a group, like WhatsApp
  &.first::before {
    content: '';
    position: absolute;
    top: 0;
    width: 9px;
    height: 13px;
    background: var(--bubble-bg);
  }

  .in &.first {
    border-start-start-radius: 0;

    &::before {
      inset-inline-start: -8px;
      clip-path: polygon(0 0, 100% 0, 100% 100%);
    }
  }

  .out &.first {
    border-start-end-radius: 0;

    &::before {
      inset-inline-end: -8px;
      clip-path: polygon(0 0, 100% 0, 0 100%);
    }
  }

  [dir='rtl'] .in &.first::before {
    clip-path: polygon(0 0, 100% 0, 0 100%);
  }

  [dir='rtl'] .out &.first::before {
    clip-path: polygon(0 0, 100% 0, 100% 100%);
  }

  &.sticker::before {
    display: none;
  }

  &.visual {
    padding: 0.2rem 0.2rem 0.25rem;

    .sender, .forwarded, .quote, :deep(.message-text) {
      margin-inline: 0.35rem;
    }
  }

  &.sticker {
    background: transparent;
    box-shadow: none;
    padding: 0;
  }

  &:hover .menu-trigger {
    opacity: 1;
  }
}

.menu-trigger {
  position: absolute;
  top: 2px;
  inset-inline-end: 2px;
  z-index: 2;
  width: 1.6rem;
  height: 1.6rem;
  border: none;
  border-radius: 50%;
  background: var(--bubble-bg);
  color: var(--text-color-secondary);
  box-shadow: 0 0 6px 4px var(--bubble-bg);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;

  &:focus-visible {
    opacity: 1;
  }
}

.sender {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0 0.4rem;
  margin-bottom: 0.15rem;
  padding-inline-end: 1.2rem;
  font-size: 0.8rem;
}

.sender-name {
  font-weight: 600;
}

.sender-phone, .sender-tag {
  color: var(--text-color-secondary);
  font-size: 0.75rem;
}

.forwarded {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin-bottom: 0.15rem;
  font-size: 0.75rem;
  font-style: italic;
  color: var(--text-color-secondary);

  i {
    font-size: 0.7rem;
  }
}

.muted {
  padding-inline-end: 4.5rem;
  font-style: italic;
  color: var(--text-color-secondary);

  i {
    font-size: 0.85rem;
    margin-inline-end: 0.2rem;
  }
}

.link-preview {
  display: flex;
  align-items: stretch;
  margin-bottom: 0.3rem;
  border-radius: 6px;
  overflow: hidden;
  background: var(--surface-ground);
  color: inherit;
  text-decoration: none;
  max-width: 380px;
}

.link-thumb {
  flex-shrink: 0;
  width: 5.5rem;
  min-height: 5.5rem;
  object-fit: cover;
}

.link-info {
  min-width: 0;
  padding: 0.45rem 0.6rem;
  line-height: 1.35;
}

.link-title {
  font-weight: 600;
  font-size: 0.85rem;
}

.link-description {
  font-size: 0.78rem;
  color: var(--text-color-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.link-domain {
  font-size: 0.72rem;
  color: var(--text-color-secondary);
  margin-top: 0.1rem;
}

.meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.25rem;
  font-size: 0.68rem;
  line-height: 1;
  color: var(--text-color-secondary);
  white-space: nowrap;

  &.meta-inline {
    position: absolute;
    bottom: 0.35rem;
    inset-inline-end: 0.55rem;

    &.meta-flipped {
      inset-inline-end: auto;
      inset-inline-start: 0.55rem;
    }
  }

  &.meta-block {
    margin-top: 0.2rem;
  }

  &.meta-overlay {
    position: absolute;
    bottom: 0.55rem;
    inset-inline-end: 0.55rem;
    z-index: 1;
    padding: 0.2rem 0.4rem;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.5);
    color: #fff;
    pointer-events: none;
  }

  .sticker &.meta-overlay {
    bottom: 0.2rem;
  }

  .ack {
    font-size: 0.75rem;
  }

  :deep(.pi) {
    font-size: 0.75rem;
  }
}

.edited {
  font-style: italic;
}

.reactions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: -0.35rem;
  padding: 0 0.4rem;
  position: relative;
  z-index: 1;
}

.reaction {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  padding: 0.05rem 0.4rem;
  border-radius: 12px;
  background: var(--surface-card);
  border: 1px solid var(--surface-border);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  font-size: 0.85rem;
  cursor: default;

  &.mine {
    border-color: var(--primary-color);
  }
}

.reaction-count {
  font-size: 0.7rem;
  color: var(--text-color-secondary);
}

.notice {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  max-width: 85%;
  padding: 0.3rem 0.75rem;
  border-radius: 8px;
  background: var(--surface-card);
  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.1);
  color: var(--text-color-secondary);
  font-size: 0.8rem;
  text-align: center;

  &.missed i {
    color: var(--red-500, #ef4444);
  }
}

.notice-time {
  font-size: 0.68rem;
  opacity: 0.8;
}
</style>
