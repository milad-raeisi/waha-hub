<script setup>
import {useI18n} from "vue-i18n";
import {useToast} from "primevue/usetoast";
import ChatMessage from "./ChatMessage.vue";
import JsonDataViewer from "../common/JsonDataViewer.vue";
import {buildTimeline} from "../../utils/chat/timeline";
import {MEDIA_KINDS} from "../../utils/chat/messageParser";
import {useChatMedia} from "../../composables/chat/useChatMedia";

const props = defineProps({
  messages: Array,
  chatId: String,
  loading: Boolean,
  loadEarlier: Function,
  loadingEarlier: Boolean,
  hasEarlierMessages: Boolean,
  serverId: String,
  sessionName: String,
  isGroup: Boolean,
  meId: String,
  participantTags: Object,
  myTag: String,
  editMyTag: Function,
})
const emit = defineEmits(['reply'])
const {t, locale} = useI18n()
const toast = useToast()
const {entryFor, load, save} = useChatMedia()

const items = computed(() => {
  const seen = new Set()
  const unique = (props.messages || []).filter((message) => {
    if (!message?.id || seen.has(message.id)) return false
    seen.add(message.id)
    return true
  })
  return buildTimeline(unique)
})

//
// Names: push names seen in the loaded messages, used for quotes, reactions and @mentions
//
function userOf(jid) {
  return String(jid || '').split('@')[0].split(':')[0]
}

const names = computed(() => {
  const map = {}
  for (const item of items.value) {
    if (item.type !== 'message' || !item.parsed.senderName || item.message.fromMe) continue
    const jid = item.message.participant || item.message.from
    if (jid) map[userOf(jid)] = item.parsed.senderName
  }
  return map
})

function nameOf(jid) {
  if (!jid) return null
  const user = userOf(jid)
  if (jid === 'me' || (props.meId && user === userOf(props.meId))) return t('chat.message.you')
  return names.value[user] || null
}

function participantTagOf(message) {
  if (!props.participantTags || !message?.participant) return null
  return props.participantTags[message.participant] || null
}

//
// Scrolling
//
const scroll = ref(null)
const content = ref(null)
const sentinel = ref(null)
const atBottom = ref(true)
const unseen = ref(0)
const isLoadingEarlier = ref(false)
let knownKeys = new Set()
let initialized = false

function scrollToBottom(smooth = false) {
  const element = scroll.value
  if (!element) return
  element.scrollTo({top: element.scrollHeight, behavior: smooth ? 'smooth' : 'auto'})
  atBottom.value = true
  unseen.value = 0
}

function onScroll() {
  const element = scroll.value
  if (!element) return
  atBottom.value = element.scrollHeight - element.scrollTop - element.clientHeight < 80
  if (atBottom.value) unseen.value = 0
}

function lastMessage(list) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].type === 'message') return list[i]
  }
  return null
}

watch(() => [props.chatId, items.value], async ([chatId, list], [previousChatId, previousList] = []) => {
  const element = scroll.value
  const chatChanged = chatId !== previousChatId || !initialized
  const distanceFromBottom = element ? element.scrollHeight - element.scrollTop : 0
  const last = lastMessage(list)
  const previousLast = lastMessage(previousList || [])
  const appended = !!last && last.id !== previousLast?.id

  const newKeys = []
  for (const item of list) {
    if (item.type === 'message' && !knownKeys.has(item.id)) newKeys.push(item)
  }
  if (chatChanged) knownKeys = new Set()
  newKeys.forEach((item) => knownKeys.add(item.id))

  await nextTick()
  if (!scroll.value) return
  if (chatChanged) {
    initialized = list.length > 0
    unseen.value = 0
    scrollToBottom()
    fillViewport()
  } else if (isLoadingEarlier.value) {
    scroll.value.scrollTop = scroll.value.scrollHeight - distanceFromBottom
  } else if (appended) {
    if (atBottom.value || last.message.fromMe) {
      scrollToBottom(true)
    } else {
      unseen.value += newKeys.filter((item) => !item.message.fromMe && !item.centered).length
    }
  }
}, {flush: 'pre'})

// Keep the view pinned to the bottom while images and previews load
let resizeObserver = null
let sentinelObserver = null
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && content.value) {
    resizeObserver = new ResizeObserver(() => {
      if (atBottom.value && !isLoadingEarlier.value && scroll.value) {
        scroll.value.scrollTop = scroll.value.scrollHeight
      }
    })
    resizeObserver.observe(content.value)
  }
  if (typeof IntersectionObserver !== 'undefined' && sentinel.value) {
    sentinelObserver = new IntersectionObserver((records) => {
      if (records.some((record) => record.isIntersecting)) handleLoadEarlier()
    }, {root: scroll.value, rootMargin: '300px 0px 0px 0px'})
    sentinelObserver.observe(sentinel.value)
  }
  scrollToBottom()
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  sentinelObserver?.disconnect()
})

async function handleLoadEarlier() {
  if (!props.loadEarlier || !initialized || isLoadingEarlier.value || props.loadingEarlier) return
  if (!props.hasEarlierMessages || props.loading || !items.value.length) return
  isLoadingEarlier.value = true
  try {
    await props.loadEarlier()
    await nextTick()
  } finally {
    // Let the scroll restoration in the watcher run first
    setTimeout(() => {
      isLoadingEarlier.value = false
      fillViewport()
    }, 50)
  }
}

// Short chats: keep loading history until the view is filled (the top sentinel stays visible otherwise)
function fillViewport() {
  const element = scroll.value
  if (element && props.hasEarlierMessages && element.scrollHeight <= element.clientHeight + 50) {
    handleLoadEarlier()
  }
}

//
// Jump to a quoted message
//
const highlightedKey = ref(null)
let highlightTimer = null

function jumpTo(key) {
  if (!key || !scroll.value) return
  const target = scroll.value.querySelector(`[data-key="${CSS.escape(key)}"]`)
  if (!target) {
    toast.add({severity: 'info', summary: t('chat.message.jumpNotFound'), life: 3500})
    return
  }
  target.scrollIntoView({block: 'center', behavior: 'smooth'})
  highlightedKey.value = key
  clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => {
    highlightedKey.value = null
  }, 1700)
}

//
// Per-message actions (one shared menu)
//
const menu = ref(null)
const menuItem = ref(null)
const detailsVisible = ref(false)
const detailsItem = ref(null)

function itemText(item) {
  if (!item) return ''
  return item.editedText ?? item.parsed.text ?? ''
}

async function copyText(text, summary) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({severity: 'success', summary: summary || t('chat.message.copied'), life: 2000})
  } catch (e) {
    console.warn('Clipboard is not available', e)
  }
}

async function downloadItem(item) {
  const result = await load(props.serverId, props.sessionName, item.message, true)
  if (result.status === 'ready') {
    save(result, item.message.id)
  } else {
    toast.add({
      severity: 'error',
      summary: t('chat.message.downloadFailedTitle'),
      detail: result.error === 'NO_URL' ? t('chat.message.downloadFailedNoUrl') : result.error,
      life: 5000,
    })
  }
}

const menuItems = computed(() => {
  const item = menuItem.value
  if (!item) return []
  const isMedia = MEDIA_KINDS.includes(item.parsed.kind) && !item.revoked && !item.parsed.media?.viewOnce
  const text = itemText(item)
  return [
    {
      label: t('chat.message.actions.reply'),
      icon: 'pi pi-reply',
      visible: !item.revoked && item.parsed.kind !== 'revoked',
      command: () => emit('reply', item),
    },
    {
      label: t('chat.message.actions.copy'),
      icon: 'pi pi-copy',
      visible: !!text && !item.revoked,
      command: () => copyText(text),
    },
    {
      label: t('chat.message.actions.download'),
      icon: 'pi pi-download',
      visible: isMedia,
      command: () => downloadItem(item),
    },
    {separator: true},
    {
      label: t('chat.message.actions.copyId'),
      icon: 'pi pi-hashtag',
      command: () => copyText(item.message.id, t('chat.message.copied')),
    },
    {
      label: t('chat.message.actions.details'),
      icon: 'pi pi-code',
      command: () => {
        detailsItem.value = item
        detailsVisible.value = true
      },
    },
  ]
})

function openMenu(event, item) {
  menuItem.value = item
  menu.value?.toggle(event)
}

const detailsData = computed(() => {
  const item = detailsItem.value
  if (!item) return null
  const entry = entryFor(props.serverId, props.sessionName, item.message.id)
  return entry.fullMessage || item.message
})

//
// Day separators
//
function dayLabel(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const today = new Date()
  const startOfDay = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const days = Math.round((startOfDay(today) - startOfDay(date)) / 86400000)
  if (days === 0) return t('chat.date.today')
  if (days === 1) return t('chat.date.yesterday')
  const options = days < 7
      ? {weekday: 'long'}
      : {day: 'numeric', month: 'long', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric'}
  return new Intl.DateTimeFormat(locale.value || undefined, options).format(date)
}

defineExpose({scrollToBottom})
</script>

<template>
  <div class="chat-messages">
    <div ref="scroll" class="chat-scroll" @scroll.passive="onScroll">
      <div ref="content" class="chat-content">
        <div ref="sentinel" class="sentinel"></div>
        <div v-if="items.length" class="history">
          <Button
              v-if="hasEarlierMessages"
              :label="t('chat.loadMoreMessages')"
              icon="pi pi-arrow-up"
              size="small"
              text
              :loading="loadingEarlier || isLoadingEarlier"
              @click="handleLoadEarlier"
          />
          <span v-else class="history-end">
            <i class="pi pi-lock"></i> {{ t('chat.noMoreMessages') }}
          </span>
        </div>

        <!-- First load -->
        <div v-if="loading && !items.length" class="skeletons">
          <div v-for="index in 6" :key="index" class="skeleton-row" :class="{ out: index % 3 === 0 }">
            <Skeleton :width="`${8 + (index * 37) % 12}rem`" height="2.4rem" border-radius="10px"/>
          </div>
        </div>
        <div v-else-if="!items.length" class="empty">
          <i class="pi pi-inbox"></i>
          <span>{{ t('chat.noMessages') }}</span>
        </div>

        <template v-for="item in items" :key="item.id">
          <div v-if="item.type === 'date'" class="date-separator">
            <span>{{ dayLabel(item.timestamp) }}</span>
          </div>
          <ChatMessage
              v-else
              :item="item"
              :serverId="serverId"
              :sessionName="sessionName"
              :isGroup="isGroup"
              :participantTag="participantTagOf(item.message)"
              :myTag="myTag"
              :editMyTag="editMyTag"
              :nameOf="nameOf"
              :mentions="names"
              :highlighted="highlightedKey === item.key"
              @menu="openMenu"
              @jump="jumpTo"
          />
        </template>
      </div>
    </div>

    <transition name="fade">
      <div v-if="!atBottom && items.length" class="jump-bottom">
        <Button
            icon="pi pi-angle-double-down"
            rounded
            severity="secondary"
            v-tooltip.left="t('chat.scrollToBottom')"
            :aria-label="t('chat.scrollToBottom')"
            @click="scrollToBottom(true)"
        />
        <Badge v-if="unseen" :value="unseen" class="jump-badge"/>
      </div>
    </transition>

    <Menu ref="menu" :model="menuItems" popup class="chat-popup"/>

    <Dialog
        v-model:visible="detailsVisible"
        :header="t('chat.message.detailsTitle')"
        class="chat-popup"
        modal
        dismissableMask
        :style="{ width: 'min(900px, 92vw)' }"
    >
      <JsonDataViewer v-if="detailsData" :data="detailsData" :deep="3"/>
    </Dialog>
  </div>
</template>

<style scoped lang="scss">
.chat-messages {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.chat-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  // Subtle dotted wallpaper, adapts to the theme
  background-color: var(--surface-ground);
  background-image: radial-gradient(var(--surface-border) 1px, transparent 1px);
  background-size: 18px 18px;
}

.chat-content {
  display: flex;
  flex-direction: column;
  padding-bottom: 0.75rem;
  min-height: 100%;
}

.sentinel {
  height: 1px;
  flex-shrink: 0;
}

.history {
  display: flex;
  justify-content: center;
  padding: 0.25rem 0 0.5rem;
}

.history-end {
  padding: 0.3rem 0.75rem;
  border-radius: 8px;
  font-size: 0.75rem;
  color: var(--text-color-secondary);
  background: var(--surface-card);

  i {
    font-size: 0.7rem;
  }
}

.date-separator {
  position: sticky;
  top: 0.4rem;
  z-index: 3;
  display: flex;
  justify-content: center;
  margin: 0.75rem 0 0.25rem;
  pointer-events: none;

  span {
    padding: 0.25rem 0.75rem;
    border-radius: 8px;
    background: var(--surface-card);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
    font-size: 0.75rem;
    color: var(--text-color-secondary);
  }
}

.skeletons {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 1rem 0.75rem;
}

.skeleton-row {
  display: flex;

  &.out {
    justify-content: flex-end;
  }
}

.empty {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-color-secondary);

  i {
    font-size: 2rem;
  }
}

.jump-bottom {
  position: absolute;
  inset-inline-end: 1.25rem;
  bottom: 1rem;
  z-index: 4;
}

.jump-badge {
  position: absolute;
  top: -0.4rem;
  inset-inline-end: -0.3rem;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.15s;
}

.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
