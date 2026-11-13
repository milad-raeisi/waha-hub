<script setup>
import {useI18n} from "vue-i18n";
import {formatBytes} from "../../utils/chat/format";

const props = defineProps({
  attachment: Object, // { id, type, file, previewUrl, asDocument }
  disabled: Boolean,
})
const emit = defineEmits(['remove', 'toggle-document'])
const {t} = useI18n()

const iconMap = {
  image: 'pi pi-image',
  video: 'pi pi-video',
  audio: 'pi pi-microphone',
  file: 'pi pi-file',
}
const icon = computed(() => props.attachment.asDocument ? 'pi pi-file' : (iconMap[props.attachment.type] || 'pi pi-file'))
const canToggle = computed(() => ['image', 'video'].includes(props.attachment.type))
const size = computed(() => formatBytes(props.attachment.file.size))
</script>

<template>
  <div class="attachment-chip" :class="{ document: attachment.asDocument }">
    <div class="attachment-media">
      <img
          v-if="attachment.previewUrl && attachment.type === 'image'"
          :src="attachment.previewUrl"
          class="attachment-thumb"
          alt=""
      />
      <video
          v-else-if="attachment.previewUrl && attachment.type === 'video'"
          :src="attachment.previewUrl"
          class="attachment-thumb"
          muted
          preload="metadata"
      />
      <i v-else :class="icon" class="attachment-icon"/>
      <span v-if="attachment.previewUrl" class="attachment-type"><i :class="icon"></i></span>
    </div>
    <div class="attachment-info">
      <span class="attachment-name" :title="attachment.file.name">{{ attachment.file.name }}</span>
      <span class="attachment-size">{{ size }}</span>
    </div>
    <div class="attachment-actions">
      <Button
          v-if="canToggle"
          :icon="attachment.asDocument ? 'pi pi-image' : 'pi pi-file'"
          text
          rounded
          size="small"
          :disabled="disabled"
          v-tooltip.top="attachment.asDocument ? t('chat.send.asMedia') : t('chat.send.asDocument')"
          :aria-label="attachment.asDocument ? t('chat.send.asMedia') : t('chat.send.asDocument')"
          @click="emit('toggle-document')"
      />
      <Button
          icon="pi pi-times"
          text
          rounded
          severity="danger"
          size="small"
          :disabled="disabled"
          :aria-label="t('chat.send.removeAttachment')"
          @click="emit('remove')"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.attachment-chip {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 15rem;
  padding: 0.3rem;
  border-radius: 8px;
  background: var(--surface-card);
  border: 1px solid var(--surface-border);
}

.attachment-media {
  position: relative;
  flex-shrink: 0;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-ground);
}

.attachment-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.attachment-icon {
  font-size: 1.5rem;
  color: var(--text-color-secondary);
}

.attachment-type {
  position: absolute;
  inset-inline-start: 2px;
  bottom: 2px;
  padding: 1px 3px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  line-height: 1;

  i {
    font-size: 0.6rem;
  }
}

.attachment-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.attachment-name {
  font-size: 0.78rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-size {
  font-size: 0.7rem;
  color: var(--text-color-secondary);
}

.attachment-actions {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;

  :deep(.p-button) {
    width: 1.7rem;
    height: 1.7rem;
    padding: 0;
  }
}
</style>
