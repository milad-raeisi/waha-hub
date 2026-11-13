<script setup>
import {useI18n} from "vue-i18n";
import {useChatMedia, useNearViewport} from "../../../composables/chat/useChatMedia";
import {autoDownloadMedia} from "../../../composables/chat/useChatSettings";
import {formatBytes, formatDuration} from "../../../utils/chat/format";
import {KIND_ICONS} from "../../../utils/chat/messageParser";

const props = defineProps({
  kind: String, // image | video | gif | ptv | sticker
  media: Object,
  message: Object,
  serverId: String,
  sessionName: String,
})
const {t} = useI18n()
const {entryFor, load} = useChatMedia()

const root = ref(null)
const visible = useNearViewport(root)
const entry = computed(() => entryFor(props.serverId, props.sessionName, props.message.id))
const playRequested = ref(false)

const isVideo = computed(() => ['video', 'ptv'].includes(props.kind))
const autoLoad = computed(() => ['image', 'sticker', 'gif'].includes(props.kind) && !props.media?.viewOnce)

watch([visible, autoDownloadMedia, () => props.message.id], () => {
  if (visible.value && autoDownloadMedia.value && autoLoad.value && entry.value.status === 'idle') {
    load(props.serverId, props.sessionName, props.message)
  }
}, {immediate: true})

function start() {
  if (entry.value.status === 'loading') return
  playRequested.value = true
  load(props.serverId, props.sessionName, props.message, true)
}

// Keep the bubble size stable while the media loads (no scroll jumps)
const box = computed(() => {
  if (props.kind === 'sticker') return {width: 150, height: 150}
  if (props.kind === 'ptv') return {width: 220, height: 220}
  const maxWidth = 300
  const maxHeight = 340
  const minWidth = 150
  const width = props.media?.width
  const height = props.media?.height
  if (!width || !height) return {width: 260, height: null}
  let w = Math.max(minWidth, Math.min(maxWidth, width))
  let h = w * height / width
  if (h > maxHeight) {
    h = maxHeight
    w = Math.max(minWidth, h * width / height)
  }
  return {width: Math.round(w), height: Math.round(h)}
})
const boxStyle = computed(() => props.media?.viewOnce ? {width: '260px'} : ({
  width: `${box.value.width}px`,
  height: box.value.height ? `${box.value.height}px` : undefined,
  minHeight: box.value.height ? undefined : '150px',
}))

const icon = computed(() => KIND_ICONS[props.kind] || 'pi pi-image')
const duration = computed(() => isVideo.value && props.media?.duration ? formatDuration(props.media.duration) : '')
const size = computed(() => formatBytes(props.media?.size))
const errorText = computed(() => {
  const error = entry.value.error
  return error === 'NO_URL' ? t('chat.message.downloadFailedNoUrl') : error
})
</script>

<template>
  <div ref="root" class="visual-media" :class="[`kind-${kind}`, {ready: entry.status === 'ready'}]" :style="boxStyle">
    <!-- View once: the media can't be downloaded again -->
    <div v-if="media?.viewOnce" class="view-once">
      <i class="pi pi-eye-slash"></i>
      <span>{{ t('chat.message.viewOnce') }}</span>
    </div>

    <!-- Downloaded -->
    <template v-else-if="entry.status === 'ready'">
      <Image
          v-if="kind === 'image'"
          :src="entry.url"
          alt=""
          preview
          class="media-image"
          image-class="media-el"
      />
      <img v-else-if="kind === 'sticker'" :src="entry.url" alt="" class="media-el sticker-el"/>
      <video
          v-else-if="kind === 'gif'"
          :src="entry.url"
          class="media-el"
          autoplay
          loop
          muted
          playsinline
      />
      <video
          v-else
          :src="entry.url"
          :poster="media?.thumbnail"
          :autoplay="playRequested"
          class="media-el"
          :class="{round: kind === 'ptv'}"
          controls
          playsinline
          preload="metadata"
      />
    </template>

    <!-- Thumbnail / placeholder -->
    <template v-else>
      <img
          v-if="media?.thumbnail"
          :src="media.thumbnail"
          alt=""
          class="media-el thumb"
          :class="{round: kind === 'ptv'}"
      />
      <div v-else class="placeholder" :class="{round: kind === 'ptv'}">
        <i :class="icon"></i>
      </div>
      <div class="overlay" :class="{round: kind === 'ptv'}" @click="start">
        <ProgressSpinner
            v-if="entry.status === 'loading'"
            class="spinner"
            stroke-width="4"
        />
        <Button
            v-else-if="entry.status === 'error'"
            icon="pi pi-refresh"
            rounded
            severity="danger"
            v-tooltip.top="errorText"
            :aria-label="t('chat.message.retry')"
        />
        <Button
            v-else
            :icon="isVideo ? 'pi pi-play' : 'pi pi-download'"
            rounded
            :aria-label="t('chat.message.download')"
        />
      </div>
      <div v-if="duration || size" class="badges">
        <span v-if="duration" class="badge"><i class="pi pi-video"></i> {{ duration }}</span>
        <span v-if="size && entry.status !== 'loading'" class="badge">{{ size }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.visual-media {
  position: relative;
  max-width: 100%;
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface-ground);
  line-height: 0;

  &.kind-sticker {
    background: transparent;
  }
}

.media-image {
  display: block;
  width: 100%;
  height: 100%;

  :deep(.media-el) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  :deep(.p-image-preview-indicator) {
    border-radius: 8px;
  }
}

.media-el {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.sticker-el {
  object-fit: contain;
}

video.media-el {
  background: #000;
  object-fit: contain;
}

.kind-gif video.media-el {
  object-fit: cover;
}

.thumb {
  filter: blur(2px);
  transform: scale(1.03);
}

.round {
  border-radius: 50%;
}

.placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-color-secondary);

  i {
    font-size: 2.5rem;
    opacity: 0.5;
  }
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.25);
  cursor: pointer;
}

.kind-sticker .overlay {
  background: transparent;
}

.spinner {
  width: 44px;
  height: 44px;
}

.badges {
  position: absolute;
  inset-inline-start: 6px;
  bottom: 6px;
  display: flex;
  gap: 4px;
  line-height: 1.2;
  pointer-events: none;
}

.badge {
  padding: 2px 6px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 0.7rem;

  i {
    font-size: 0.65rem;
  }
}

.view-once {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 60px;
  height: 100%;
  padding: 0.75rem;
  line-height: 1.3;
  color: var(--text-color-secondary);
  font-size: 0.85rem;

  i {
    font-size: 1.4rem;
  }
}
</style>
