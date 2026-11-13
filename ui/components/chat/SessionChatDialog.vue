<script setup>

import {sleep} from "../../services/utils";
import ChatMessages from "./ChatMessages.vue";
import ChatHeader from "./ChatHeader.vue";
import ChatList from "./ChatList.vue";
import ChatInputFooter from "./ChatInputFooter.vue";
import GroupMemberTagDialog from "./GroupMemberTagDialog.vue";
import ContactsDialog from "./ContactsDialog.vue";
import {ClientStatus, WebSocketClient} from "../../services/WebSocketService";
import {ref} from "vue";
import WebSocketStatus from "../events/WebSocketStatus.vue";
import {useI18n} from "vue-i18n";
import {releaseChatMedia} from "../../composables/chat/useChatMedia";
import {releaseProfilePictures} from "../../composables/chat/useProfilePictures";
import {useEscapeGuard} from "../../composables/chat/useEscapeGuard";
import {
  autoDownloadMedia,
  hiddenReading,
  setAutoDownloadMedia,
  setHiddenReading,
} from "../../composables/chat/useChatSettings";
import {timestampMs} from "../../utils/chat/timeline";
import {formatJid, senderColor} from "../../utils/chat/format";

const {t, locale} = useI18n();

// Escape closes only the top-most layer (photo preview / nested dialog), not the whole chat
useEscapeGuard()

// Persian and Arabic: right-to-left chat, like WhatsApp in these languages
const RTL_LOCALES = ['fa', 'ar']
const dir = computed(() => RTL_LOCALES.includes(locale.value) ? 'rtl' : 'ltr')
// The splitter itself stays LTR (its drag math is LTR-only) - the panels are swapped instead
const panels = computed(() => dir.value === 'rtl' ? ['chat', 'list'] : ['list', 'chat'])

const visible = defineModel("visible");
const session = defineModel("session");

const toast = useToast();
const store = useServerStore()
const mergeOverview = ref(true)
const chats = ref([])
const pending = ref(false)
const chatsOffset = ref(0)
const loadingMoreChats = ref(false)

async function refreshChats() {
  chatsOffset.value = 0
  pending.value = true
  try {
    const data = await store.getChatsOverview(
        session.value.server.id,
        session.value.name,
        10,
        undefined,
        mergeOverview.value,
    )
    chats.value = data || []
  } finally {
    pending.value = false
  }
}

async function loadMoreChats() {
  if (loadingMoreChats.value) return
  loadingMoreChats.value = true
  try {
    const nextOffset = chatsOffset.value + 10
    const data = await store.getChatsOverview(
        session.value.server.id,
        session.value.name,
        10,
        nextOffset,
        mergeOverview.value,
    )
    if (data && data.length > 0) {
      chatsOffset.value = nextOffset
      chats.value = [...chats.value, ...data]
    }
  } finally {
    loadingMoreChats.value = false
  }
}

const selectedChat = ref(null)
const messages = ref([])
const replyTo = ref(null)

const isGroupChat = computed(() => !!selectedChat.value?.id?.endsWith('@g.us'))
const participantTags = ref(null)
const myTag = ref(null)
const showMyTagDialog = ref(false)
const savingMyTag = ref(false)

// Tags are requested per participant, the engine resolves lid vs phone number itself
async function fetchParticipantTags() {
  if (!isGroupChat.value) {
    participantTags.value = null
    myTag.value = null
    return
  }
  const groupId = selectedChat.value.id
  const serverId = session.value.server.id
  const sessionName = session.value.name
  const known = participantTags.value || {}
  const participants = [...new Set(
      messages.value
          .filter((message) => !message.fromMe && message.participant)
          .map((message) => message.participant),
  )].filter((participant) => !(participant in known))
  try {
    const [mine, ...tags] = await Promise.all([
      store.getMyGroupParticipantTag(serverId, sessionName, groupId),
      ...participants.map((participant) =>
          store.getGroupParticipantTag(serverId, sessionName, groupId, participant),
      ),
    ])
    // The user may have switched chats while loading
    if (selectedChat.value?.id !== groupId) return
    const byId = {...known}
    participants.forEach((participant, index) => {
      byId[participant] = tags[index]?.tag || null
    })
    participantTags.value = byId
    myTag.value = mine?.tag || null
  } catch (e) {
    // Engines without member tags - keep the chat usable
    console.warn('Failed to load group member tags', e)
    participantTags.value = null
    myTag.value = null
  }
}

function editMyTag() {
  showMyTagDialog.value = true
}

async function saveMyTag(tag) {
  savingMyTag.value = true
  try {
    await store.setMyGroupParticipantTag(session.value.server.id, session.value.name, selectedChat.value.id, tag)
    showMyTagDialog.value = false
    participantTags.value = null
    await fetchParticipantTags()
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: t('chat.tags.updateFailedTitle'),
      detail: e?.response?.data?.message || e?.message || String(e),
      life: 5000,
    })
  } finally {
    savingMyTag.value = false
  }
}

const profilePicture = ref(null)
watch(selectedChat, (chat, previous) => {
  if (!chat || chat.id === previous?.id) {
    return
  }
  participantTags.value = null
  myTag.value = null
  replyTo.value = null
  messages.value = []
  fetchMessages()
})
const fetchingMessages = ref(false)
const loadingEarly = ref(false)
const hasEarlierMessages = ref(true)
const limit = ref(20)
const offset = ref(0)

let client = null
const clientStatus = ref(ClientStatus.DISCONNECTED)

const LISTEN_EVENTS = [
  'message.any',
  'message.ack',
  'message.reaction',
  'message.revoked',
  'message.edited',
  'group.v2.participants.tag',
]

function startClient() {
  const server = store.getServer(session.value.server.id)
  client = new WebSocketClient(server, LISTEN_EVENTS, session.value.name)
  client.connect()
  clientStatus.value = ClientStatus.CONNECTING
  client.on("open", () => {
    clientStatus.value = ClientStatus.CONNECTED
  })
  client.on("close", () => {
    clientStatus.value = ClientStatus.DISCONNECTED
    restartClient()
  })
  client.on("error", () => {
    clientStatus.value = ClientStatus.ERROR
    restartClient()
  })
  client.on("event", handleEvent)
}

// Lazy cache of "merged" counterpart ids: "123@lid" <-> "123@c.us".
// Filled only on demand (when an event doesn't match the opened chat directly),
// never on chat selection. Only known (non-null) mappings are cached so an
// unknown one gets retried on the next event.
let chatIdAliases = new Map()

async function resolveChatAlias(chatId) {
  const cached = chatIdAliases.get(chatId)
  if (cached) {
    return cached
  }
  const serverId = session.value.server.id
  const sessionName = session.value.name
  let alias = null
  try {
    if (chatId.endsWith('@lid')) {
      const result = await store.findPNByLid(serverId, sessionName, chatId)
      alias = result?.pn || null
    } else if (chatId.endsWith('@c.us')) {
      const result = await store.findLIDByPhoneNumber(serverId, sessionName, chatId)
      alias = result?.lid || null
    }
  } catch (e) {
    console.warn('Failed to resolve lid/pn alias for chat', chatId, e)
    return null
  }
  if (alias) {
    chatIdAliases.set(chatId, alias)
  }
  return alias
}

// Chats an event belongs to (revoked / edited events wrap the message)
function eventChatIds(payload) {
  const ids = new Set()
  for (const value of [payload, payload?.after, payload?.before]) {
    if (value?.from) ids.add(value.from)
    if (value?.to) ids.add(value.to)
  }
  return ids
}

async function eventMatchesOpenedChat(payload) {
  const chatId = selectedChat.value?.id
  if (!chatId) {
    return false
  }
  const ids = eventChatIds(payload)
  if (ids.has(chatId)) {
    return true
  }
  // The overview merges @lid and @c.us chats of the same contact, so the opened
  // chat may be "447@c.us" while the event arrives from "265@lid" (or vice versa).
  const alias = await resolveChatAlias(chatId)
  // The user may have switched chats while we were resolving
  return !!alias && selectedChat.value?.id === chatId && ids.has(alias)
}

function updateAck(payload) {
  const id = payload?.id
  if (!id || payload.ack === undefined) {
    return false
  }
  const message = messages.value.find((item) => item.id === id)
  if (!message) {
    return false
  }
  if ((message.ack ?? -2) < payload.ack) {
    message.ack = payload.ack
    message.ackName = payload.ackName
  }
  return true
}

let refreshTimer = null

// Many events arrive in bursts (message + ack + reaction) - refetch once
function scheduleRefresh(delay = 1000) {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    refreshLatestMessages()
  }, delay)
}

async function handleEvent(event) {
  if (event.event === 'group.v2.participants.tag') {
    if (event.payload?.group?.id === selectedChat.value?.id) {
      participantTags.value = null
      fetchParticipantTags()
    }
    return
  }
  if (event.event === 'message.ack') {
    if (updateAck(event.payload)) {
      return
    }
  }
  if (event.event === 'message.any') {
    sleep(1000).then(refreshChats)
  }
  if (await eventMatchesOpenedChat(event.payload)) {
    scheduleRefresh()
  }
}

function restartClient() {
}

function stopClient() {
  client?.stop()
  client = null
  clientStatus.value = ClientStatus.DISCONNECTED
}

function sortByTimestamp(list) {
  return [...list].sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp))
}

function getMessagesPage(chatId, pageOffset) {
  return store.getChatsMessages(
      session.value.server.id,
      session.value.name,
      chatId,
      limit.value,
      pageOffset,
      false,
      mergeOverview.value,
  )
}

// First page of a chat - replaces everything
async function fetchMessages() {
  const chatId = selectedChat.value?.id
  if (!chatId) return
  offset.value = 0
  hasEarlierMessages.value = true
  fetchingMessages.value = true
  try {
    const data = await getMessagesPage(chatId, 0)
    if (selectedChat.value?.id !== chatId) return
    messages.value = sortByTimestamp(data || [])
    hasEarlierMessages.value = (data || []).length >= limit.value
    fetchParticipantTags()
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: t('chat.loadFailedTitle'),
      detail: e?.response?.data?.message || e?.message || String(e),
      life: 5000,
    })
  } finally {
    if (selectedChat.value?.id === chatId) {
      fetchingMessages.value = false
    }
  }
}

// Newest page merged into what is loaded - keeps the history the user scrolled through
async function refreshLatestMessages() {
  const chatId = selectedChat.value?.id
  if (!chatId) return
  try {
    const data = await getMessagesPage(chatId, 0)
    if (selectedChat.value?.id !== chatId || !data) return
    const byId = new Map(messages.value.map((message) => [message.id, message]))
    let added = 0
    for (const message of data) {
      if (!byId.has(message.id)) added++
      byId.set(message.id, message)
    }
    // New messages shift the pages - keep "load earlier" from returning duplicates
    offset.value += added
    messages.value = sortByTimestamp([...byId.values()])
    fetchParticipantTags()
  } catch (e) {
    console.warn('Failed to refresh messages', e)
  }
}

async function loadEarlyMessages() {
  if (loadingEarly.value || !selectedChat.value) return
  const chatId = selectedChat.value.id
  loadingEarly.value = true
  try {
    const nextOffset = offset.value + limit.value
    const data = await getMessagesPage(chatId, nextOffset)
    if (selectedChat.value?.id !== chatId) return
    if (data && data.length > 0) {
      offset.value = nextOffset
      const known = new Set(messages.value.map((message) => message.id))
      const older = data.filter((message) => !known.has(message.id))
      messages.value = sortByTimestamp([...older, ...messages.value])
      hasEarlierMessages.value = data.length >= limit.value
      fetchParticipantTags()
    } else {
      hasEarlierMessages.value = false
    }
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: t('chat.loadFailedTitle'),
      detail: e?.response?.data?.message || e?.message || String(e),
      life: 5000,
    })
  } finally {
    loadingEarly.value = false
  }
}

function onMergeToggle(value) {
  mergeOverview.value = value
  refreshChats()
}

function initializeDialog() {
  if (!session.value?.server?.id || !session.value?.name) {
    return;
  }
  mergeOverview.value = true
  chatIdAliases = new Map()
  stopClient()
  startClient()
  refreshChats()

  if (!session.value?.me?.id) {
    profilePicture.value = null
    return
  }
  store.getProfilePicture(session.value.server.id, session.value.name, session.value.me.id).then((data) => {
    profilePicture.value = data.profilePictureURL
  })
}

watch(
    () => [visible.value, session.value?.server?.id, session.value?.name],
    ([isVisible, serverId, sessionName], [wasVisible, previousServerId, previousSessionName] = []) => {
      if (!isVisible) {
        selectedChat.value = null
        messages.value = []
        replyTo.value = null
        clearTimeout(refreshTimer)
        stopClient()
        releaseChatMedia(serverId || previousServerId, sessionName || previousSessionName)
        releaseProfilePictures(serverId || previousServerId, sessionName || previousSessionName)
        return
      }

      const becameVisible = !wasVisible && isVisible
      const sessionChangedWhileOpen =
          wasVisible && isVisible && (serverId !== previousServerId || sessionName !== previousSessionName)

      if (sessionChangedWhileOpen) {
        selectedChat.value = null
        messages.value = []
        releaseChatMedia(previousServerId, previousSessionName)
      }
      if (becameVisible || sessionChangedWhileOpen) {
        initializeDialog()
      }
    }
)

onBeforeUnmount(() => {
  clearTimeout(refreshTimer)
  stopClient()
})

function clickOnChat(chat) {
  selectedChat.value = chat
}

const showContacts = ref(false)

// "Open chat" from the contacts dialog - reuse the loaded chat when it is in the list
function openChatFromContacts({id, name}) {
  const known = chats.value.find((chat) => chat.id === id)
  selectedChat.value = known || {id, name, picture: null}
}

//
// Sending
//
function sendErrorToast(e) {
  toast.add({
    severity: 'error',
    summary: t('chat.sendFailedTitle'),
    detail: e?.response?.data?.message || e?.message || String(e),
    life: 5000,
  })
}

async function sendMedia(type, file, base64, caption, replyToId) {
  if (!selectedChat.value) return
  const serverId = session.value.server.id
  const sessionName = session.value.name
  const chatId = selectedChat.value.id
  const mediaFile = {data: base64, mimetype: file.type || 'application/octet-stream', filename: file.name}
  try {
    if (type === 'image') {
      await store.sendImage(serverId, sessionName, chatId, mediaFile, caption, replyToId)
    } else if (type === 'video') {
      await store.sendVideo(serverId, sessionName, chatId, mediaFile, caption, replyToId)
    } else if (type === 'audio') {
      await store.sendVoice(serverId, sessionName, chatId, mediaFile, replyToId)
    } else {
      await store.sendFile(serverId, sessionName, chatId, mediaFile, caption, replyToId)
    }
    scheduleRefresh()
  } catch (e) {
    sendErrorToast(e)
    throw e
  }
}

async function sendText(text, replyToId) {
  if (!selectedChat.value) {
    return
  }
  // Hidden reading: never send read receipts (blue ticks) to the contact
  if (!hiddenReading.value) {
    try {
      await store.readChatMessages(
          session.value.server.id,
          session.value.name,
          selectedChat.value.id,
      )
    } catch (e) {
      console.warn('Failed to mark chat as read before sending text', e)
      toast.add({
        severity: 'warn',
        summary: t('chat.readFailedTitle'),
        detail: t('chat.readFailedDescription'),
        life: 4000,
      })
    }
  }
  try {
    await store.sendText(session.value.server.id, session.value.name, selectedChat.value.id, text, replyToId)
    scheduleRefresh()
  } catch (e) {
    sendErrorToast(e)
    throw e
  }
}

//
// Reply
//
function startReply(item) {
  replyTo.value = item
}

const replySender = computed(() => {
  const message = replyTo.value?.message
  if (!message) return ''
  if (message.fromMe) return t('chat.message.you')
  return replyTo.value.parsed.senderName || formatJid(message.participant || message.from)
})
const replyColor = computed(() => senderColor(replyTo.value?.senderId))

//
// Drag & drop files into the chat
//
const footer = ref(null)
const dragging = ref(false)
let dragDepth = 0

function hasFiles(event) {
  return [...(event.dataTransfer?.types || [])].includes('Files')
}

function onDragEnter(event) {
  if (!hasFiles(event) || !selectedChat.value) return
  dragDepth++
  dragging.value = true
}

function onDragLeave(event) {
  if (!hasFiles(event)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragging.value = false
}

function onDrop(event) {
  dragDepth = 0
  dragging.value = false
  const files = [...(event.dataTransfer?.files || [])]
  if (files.length && selectedChat.value) {
    footer.value?.addFiles(files)
  }
}

const showPromo = ref(false)
</script>

<template>
  <Dialog :dismissableMask="true"
      v-model:visible="visible"
      :modal="true"
      maximizable
      style="width: 90%; height: 90%;"
      :contentStyle="{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: '1 1 auto', minHeight: 0 }"
  >
    <template #header>
      <div>

        <SessionHeader
            :session="session"
        ></SessionHeader>
      </div>
    </template>
    <div class="chat-ui chat-root" :dir="dir">
    <div class="pb-3 flex align-items-center flex-wrap gap-3">
      <div class="flex align-items-center gap-1">
        <SessionChip
            v-if="session.me"
            :session="session"
            :image="profilePicture"
        >
        </SessionChip>
        <WebSocketStatus :status="clientStatus"></WebSocketStatus>
      </div>
      <div class="m-auto">
        <div class="text-center">
          <a href="#" @click.prevent="showPromo = true">
            <b>{{ t('chat.aboutChatUI') }}</b>
          </a>
        </div>
        <ChatPromo
            style="max-width:50em"
            v-if="showPromo"
            @close="showPromo = false"
        ></ChatPromo>
      </div>
      <Button
          :label="t('contacts.open')"
          icon="pi pi-users"
          size="small"
          outlined
          @click="showContacts = true"
      />
      <ContactsDialog
          v-model:visible="showContacts"
          :serverId="session.server.id"
          :sessionName="session.name"
          @open-chat="openChatFromContacts"
      />
      <div class="flex align-items-center gap-2" v-tooltip.bottom="t('chat.hiddenReadingTooltip')">
        <i class="pi pi-eye-slash text-sm" :class="{ 'text-primary': hiddenReading }"></i>
        <span class="text-sm font-medium">{{ t('chat.hiddenReading') }}</span>
        <InputSwitch :modelValue="hiddenReading" @update:modelValue="setHiddenReading"/>
      </div>
      <div class="flex align-items-center gap-2" v-tooltip.bottom="t('chat.autoDownloadMediaTooltip')">
        <i class="pi pi-download text-sm"></i>
        <span class="text-sm font-medium">{{ t('chat.autoDownloadMedia') }}</span>
        <InputSwitch :modelValue="autoDownloadMedia" @update:modelValue="setAutoDownloadMedia"/>
      </div>
    </div>

    <Splitter class="chat-splitter" dir="ltr">
      <SplitterPanel
          v-for="panel in panels"
          :key="panel"
          :size="panel === 'list' ? 30 : 70"
          :class="panel === 'list' ? 'chat-list-panel' : 'chat-panel'"
      >
        <div v-if="panel === 'list'" class="chat-list-inner" :dir="dir">
        <ChatList
            :chats="chats"
            :pending="pending"
            :serverId="session.server.id"
            :sessionName="session.name"
            :merge="mergeOverview"
            :loadMoreChats="loadMoreChats"
            :loadingMoreChats="loadingMoreChats"
            :selectedChatId="selectedChat?.id"
            @click-on-chat="clickOnChat"
            @refresh-chats="refreshChats"
            @update:merge="onMergeToggle"
        ></ChatList>
        </div>
        <div
            v-else
            class="chat-panel-inner"
            :dir="dir"
            @dragenter.prevent="onDragEnter"
            @dragover.prevent
            @dragleave="onDragLeave"
            @drop.prevent="onDrop"
        >
          <template v-if="selectedChat">
            <div class="chat-panel-header">
              <ChatHeader
                  :chat="selectedChat"
                  :serverId="session.server.id"
                  :sessionName="session.name"
                  :me="session.me"
                  :mePicture="profilePicture"
                  :fetch="fetchMessages"
                  :fetching="fetchingMessages"
              >
              </ChatHeader>
            </div>

            <ChatMessages
                :messages="messages"
                :chatId="selectedChat.id"
                :loading="fetchingMessages"
                :loadEarlier="loadEarlyMessages"
                :loadingEarlier="loadingEarly"
                :hasEarlierMessages="hasEarlierMessages"
                :serverId="session.server.id"
                :sessionName="session.name"
                :isGroup="isGroupChat"
                :meId="session.me?.id"
                :participantTags="participantTags"
                :myTag="myTag"
                :editMyTag="isGroupChat ? editMyTag : undefined"
                class="chat-messages-area"
                @reply="startReply"
            ></ChatMessages>
            <GroupMemberTagDialog
                v-model:visible="showMyTagDialog"
                :tag="myTag"
                :saving="savingMyTag"
                @save="saveMyTag"
            />

            <ChatInputFooter
                ref="footer"
                :key="selectedChat.id"
                :disabled="!selectedChat || (fetchingMessages && !messages.length)"
                :sendText="sendText"
                :sendMedia="sendMedia"
                :replyTo="replyTo"
                :replySender="replySender"
                :replyColor="replyColor"
                @cancel-reply="replyTo = null"
            />

            <div v-if="dragging" class="drop-overlay">
              <i class="pi pi-upload"></i>
              <span>{{ t('chat.dropFiles') }}</span>
            </div>
          </template>
          <div v-else class="no-chat">
            <i class="pi pi-comments"></i>
            <span>{{ t('chat.selectChat') }}</span>
          </div>
        </div>
      </SplitterPanel>
    </Splitter>
    </div>
  </Dialog>

</template>

<style scoped lang="scss">
.chat-root {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.chat-splitter {
  flex: 1;
  min-height: 0;
}

.chat-list-panel {
  min-height: 0;
  overflow: hidden;
}

.chat-list-inner {
  width: 100%;
  height: 100%;
}

.chat-panel {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.chat-panel-inner {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface-ground);
}

.chat-panel-header {
  padding: 0 0.75rem;
  border-bottom: 1px solid var(--surface-border);
  background: var(--surface-card);
}

.chat-messages-area {
  flex: 1;
  min-height: 0;
}

.drop-overlay {
  position: absolute;
  inset: 0.5rem;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  border: 2px dashed var(--primary-color);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface-ground) 85%, transparent);
  color: var(--primary-color);
  font-size: 1.1rem;
  font-weight: 600;
  pointer-events: none;

  i {
    font-size: 2.5rem;
  }
}

.no-chat {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  color: var(--text-color-secondary);

  i {
    font-size: 3rem;
    opacity: 0.6;
  }
}
</style>
