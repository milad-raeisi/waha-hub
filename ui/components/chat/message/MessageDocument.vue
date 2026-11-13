<script setup>
import {useI18n} from "vue-i18n";
import {useChatMedia} from "../../../composables/chat/useChatMedia";
import {formatBytes} from "../../../utils/chat/format";

const props = defineProps({
  media: Object,
  message: Object,
  serverId: String,
  sessionName: String,
})
const {t} = useI18n()
const {entryFor, load, save} = useChatMedia()

const entry = computed(() => entryFor(props.serverId, props.sessionName, props.message.id))

const filename = computed(() => props.media?.filename || entry.value.filename || t('chat.kind.document'))
const extension = computed(() => {
  const match = /\.([a-z0-9]{1,6})$/i.exec(filename.value)
  if (match) return match[1].toLowerCase()
  const subtype = (props.media?.mimetype || entry.value.mimetype || '').split('/')[1]?.split(/[;+.-]/)[0]
  return subtype ? subtype.toLowerCase().slice(0, 6) : ''
})

const TYPES = [
  {test: ['pdf'], icon: 'pi pi-file-pdf', color: 'var(--red-500, #ef4444)'},
  {test: ['doc', 'docx', 'odt', 'rtf', 'pages'], icon: 'pi pi-file-word', color: 'var(--blue-500, #3b82f6)'},
  {test: ['xls', 'xlsx', 'ods', 'csv', 'numbers'], icon: 'pi pi-file-excel', color: 'var(--green-500, #22c55e)'},
  {test: ['ppt', 'pptx', 'odp', 'key'], icon: 'pi pi-file', color: 'var(--orange-500, #f97316)'},
  {test: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'], icon: 'pi pi-box', color: 'var(--yellow-600, #ca8a04)'},
  {test: ['apk', 'exe', 'msi', 'dmg', 'pkg'], icon: 'pi pi-cog', color: 'var(--purple-500, #a855f7)'},
  {test: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'svg', 'bmp'], icon: 'pi pi-image', color: 'var(--cyan-500, #06b6d4)'},
  {test: ['mp4', 'mov', 'avi', 'mkv', 'webm', '3gp'], icon: 'pi pi-video', color: 'var(--pink-500, #ec4899)'},
  {test: ['mp3', 'ogg', 'opus', 'wav', 'm4a', 'aac', 'flac'], icon: 'pi pi-volume-up', color: 'var(--orange-500, #f97316)'},
  {test: ['txt', 'json', 'xml', 'html', 'md', 'log', 'js', 'ts', 'py'], icon: 'pi pi-file-edit', color: 'var(--surface-500)'},
]
const type = computed(() => TYPES.find((item) => item.test.includes(extension.value))
    || {icon: 'pi pi-file', color: 'var(--surface-500)'})

const details = computed(() => {
  const parts = []
  if (props.media?.pages) parts.push(t('chat.message.pages', props.media.pages))
  if (extension.value) parts.push(extension.value.toUpperCase())
  const size = formatBytes(props.media?.size || entry.value.size)
  if (size) parts.push(size)
  return parts.join(' • ')
})

// Types a browser tab can display by itself
const canOpen = computed(() => {
  const mime = entry.value.mimetype || props.media?.mimetype || ''
  return /^(application\/pdf|image\/|video\/|audio\/|text\/plain)/.test(mime)
})

async function download() {
  const result = await load(props.serverId, props.sessionName, props.message, true)
  if (result.status === 'ready') {
    save(result, props.message.id)
  }
}

async function open() {
  const result = await load(props.serverId, props.sessionName, props.message, true)
  if (result.status === 'ready' && result.url) {
    window.open(result.url, '_blank', 'noopener')
  }
}

const errorText = computed(() => {
  const error = entry.value.error
  return error === 'NO_URL' ? t('chat.message.downloadFailedNoUrl') : error
})
</script>

<template>
  <div class="document">
    <img v-if="media?.thumbnail" :src="media.thumbnail" alt="" class="document-preview"/>
    <div class="document-row">
      <div class="document-icon" :style="{ color: type.color }">
        <i :class="type.icon"></i>
      </div>
      <div class="document-info">
        <div class="document-name" dir="auto" :title="filename">{{ filename }}</div>
        <div class="document-details">{{ details }}</div>
      </div>
      <div class="document-actions">
        <Button
            v-if="canOpen && entry.status !== 'error'"
            icon="pi pi-external-link"
            text
            rounded
            size="small"
            v-tooltip.top="t('chat.message.open')"
            :aria-label="t('chat.message.open')"
            :disabled="entry.status === 'loading'"
            @click="open"
        />
        <Button
            :icon="entry.status === 'error' ? 'pi pi-refresh' : 'pi pi-download'"
            :severity="entry.status === 'error' ? 'danger' : undefined"
            :loading="entry.status === 'loading'"
            text
            rounded
            size="small"
            v-tooltip.top="entry.status === 'error' ? errorText : t('chat.message.download')"
            :aria-label="t('chat.message.download')"
            @click="download"
        />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.document {
  width: 300px;
  max-width: 100%;
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface-ground);
}

.document-preview {
  display: block;
  width: 100%;
  max-height: 160px;
  object-fit: cover;
  object-position: top;
  border-bottom: 1px solid var(--surface-border);
}

.document-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem;
}

.document-icon {
  flex-shrink: 0;

  i {
    font-size: 2rem;
  }
}

.document-info {
  flex: 1;
  min-width: 0;
}

.document-name {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.document-details {
  font-size: 0.75rem;
  color: var(--text-color-secondary);
  margin-top: 2px;
}

.document-actions {
  display: flex;
  flex-shrink: 0;
}
</style>
