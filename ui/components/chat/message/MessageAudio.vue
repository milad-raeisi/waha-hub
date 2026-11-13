<script>
// Only one voice message plays at a time across the whole chat
let currentAudio = null
</script>

<script setup>
import {useI18n} from "vue-i18n";
import {useChatMedia} from "../../../composables/chat/useChatMedia";
import {formatDuration} from "../../../utils/chat/format";

const props = defineProps({
  kind: String, // voice | audio
  media: Object,
  message: Object,
  serverId: String,
  sessionName: String,
})
const {t} = useI18n()
const {entryFor, load} = useChatMedia()

const entry = computed(() => entryFor(props.serverId, props.sessionName, props.message.id))
const audio = ref(null)
const playing = ref(false)
const currentTime = ref(0)
const realDuration = ref(null)
const rate = ref(1)

const duration = computed(() => realDuration.value || props.media?.duration || 0)
const progress = computed(() => duration.value ? Math.min(1, currentTime.value / duration.value) : 0)
const timeLabel = computed(() => formatDuration(playing.value || currentTime.value ? currentTime.value : duration.value))

const BAR_COUNT = 42

function seededBars(seed) {
  let hash = 0
  for (const char of String(seed)) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return Array.from({length: BAR_COUNT}, (_, i) => {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff
    const wave = Math.sin(i / 3) * 0.25 + 0.5
    return Math.round(25 + (hash % 50) * wave + 10)
  })
}

const bars = computed(() => {
  const waveform = props.media?.waveform
  if (!waveform?.length) return seededBars(props.message.id)
  return Array.from({length: BAR_COUNT}, (_, i) => {
    const start = Math.floor(i * waveform.length / BAR_COUNT)
    const end = Math.max(start + 1, Math.floor((i + 1) * waveform.length / BAR_COUNT))
    const slice = waveform.slice(start, end)
    return Math.max(12, Math.round(slice.reduce((a, b) => a + b, 0) / slice.length))
  })
})

async function toggle() {
  if (entry.value.status !== 'ready') {
    const result = await load(props.serverId, props.sessionName, props.message, true)
    if (result.status !== 'ready') return
    await nextTick()
  }
  const element = audio.value
  if (!element) return
  if (element.paused) {
    if (currentAudio && currentAudio !== element) currentAudio.pause()
    currentAudio = element
    element.playbackRate = rate.value
    try {
      await element.play()
    } catch (e) {
      console.warn('Audio playback failed', e)
    }
  } else {
    element.pause()
  }
}

function seek(event) {
  const element = audio.value
  if (!element || entry.value.status !== 'ready' || !duration.value) {
    toggle()
    return
  }
  const rect = event.currentTarget.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  element.currentTime = ratio * duration.value
  currentTime.value = element.currentTime
}

function cycleRate() {
  rate.value = rate.value === 1 ? 1.5 : rate.value === 1.5 ? 2 : 1
  if (audio.value) audio.value.playbackRate = rate.value
}

function onLoadedMetadata() {
  const value = audio.value?.duration
  if (Number.isFinite(value) && value > 0) realDuration.value = value
}

function onEnded() {
  playing.value = false
  currentTime.value = 0
}

onBeforeUnmount(() => {
  if (currentAudio === audio.value) currentAudio = null
  audio.value?.pause()
})

const errorText = computed(() => {
  const error = entry.value.error
  return error === 'NO_URL' ? t('chat.message.downloadFailedNoUrl') : error
})
</script>

<template>
  <div class="audio-player" :class="`kind-${kind}`">
    <div class="audio-icon">
      <i :class="kind === 'voice' ? 'pi pi-microphone' : 'pi pi-volume-up'"></i>
    </div>
    <Button
        :icon="entry.status === 'error' ? 'pi pi-refresh' : (playing ? 'pi pi-pause' : 'pi pi-play')"
        :loading="entry.status === 'loading'"
        :severity="entry.status === 'error' ? 'danger' : undefined"
        rounded
        text
        class="play-button"
        v-tooltip.top="entry.status === 'error' ? errorText : undefined"
        :aria-label="playing ? 'pause' : 'play'"
        @click="toggle"
    />
    <div class="track">
      <div v-if="kind === 'audio' && (media?.filename || entry.filename)" class="filename" dir="auto">
        {{ media?.filename || entry.filename }}
      </div>
      <div class="waveform" dir="ltr" @click="seek">
        <span
            v-for="(height, index) in bars"
            :key="index"
            class="bar"
            :class="{ played: (index + 0.5) / bars.length <= progress }"
            :style="{ height: `${height}%` }"
        ></span>
      </div>
      <div class="meta">
        <span>{{ timeLabel }}</span>
        <a v-if="kind === 'voice'" href="#" class="rate" @click.prevent="cycleRate">{{ rate }}×</a>
      </div>
    </div>
    <audio
        v-if="entry.status === 'ready'"
        ref="audio"
        :src="entry.url"
        preload="metadata"
        @play="playing = true"
        @pause="playing = false"
        @ended="onEnded"
        @timeupdate="currentTime = audio?.currentTime || 0"
        @loadedmetadata="onLoadedMetadata"
    ></audio>
  </div>
</template>

<style scoped lang="scss">
.audio-player {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 290px;
  max-width: 100%;
  padding: 0.25rem 0;
}

.audio-icon {
  flex-shrink: 0;
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-color);
  color: var(--primary-color-text);

  i {
    font-size: 1.1rem;
  }
}

.kind-audio .audio-icon {
  background: var(--orange-500, #f97316);
  color: #fff;
}

.play-button {
  flex-shrink: 0;
}

.track {
  flex: 1;
  min-width: 0;
}

.filename {
  font-size: 0.8rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}

.waveform {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 28px;
  cursor: pointer;
}

.bar {
  flex: 1;
  min-width: 2px;
  border-radius: 2px;
  background: var(--surface-400);
  transition: background-color 0.1s;

  &.played {
    background: var(--primary-color);
  }
}

.meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  color: var(--text-color-secondary);
  margin-top: 2px;
}

.rate {
  padding: 0 0.35rem;
  border-radius: 8px;
  background: var(--surface-200);
  color: var(--text-color);
  font-weight: 600;
}
</style>
