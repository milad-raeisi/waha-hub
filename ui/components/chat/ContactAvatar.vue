<script setup>
/**
 * Round avatar with the WhatsApp profile picture (lazy-loaded when visible).
 * Click opens the picture full screen (zoom / rotate). Falls back to initials.
 */
import {useI18n} from "vue-i18n";
import {useNearViewport} from "../../composables/chat/useChatMedia";
import {useProfilePictures} from "../../composables/chat/useProfilePictures";

const props = defineProps({
  serverId: String,
  sessionName: String,
  /** Contact / group id ("972...@c.us") - picture is loaded for it */
  id: String,
  name: String,
  /** Known picture URL (skips loading) */
  image: String,
  size: {
    type: String,
    default: '2.25rem',
  },
})
const {t} = useI18n()
const {entryFor, load} = useProfilePictures()

const root = ref(null)
const visible = useNearViewport(root, '150px')
const failed = ref(false)

const entry = computed(() => props.id && props.serverId ? entryFor(props.serverId, props.sessionName, props.id) : null)
const url = computed(() => failed.value ? null : (props.image || entry.value?.url || null))

watch([visible, () => props.id], () => {
  failed.value = false
  if (visible.value && !props.image && props.id) {
    load(props.serverId, props.sessionName, props.id)
  }
}, {immediate: true})

const initials = computed(() => {
  const parts = String(props.name || '?').replace(/^\+/, '').trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map((part) => [...part][0]).join('').toUpperCase() || '?'
})
</script>

<template>
  <span
      ref="root"
      class="contact-avatar"
      :class="{ 'has-picture': url }"
      :style="{ width: size, height: size }"
      @click.stop
  >
    <Image
        v-if="url"
        :src="url"
        :alt="name || id"
        preview
        class="contact-avatar__image"
        image-class="contact-avatar__img"
        v-tooltip.top="t('contacts.viewPhoto')"
        @error="failed = true"
    />
    <Avatar
        v-else
        :label="initials"
        shape="circle"
        class="contact-avatar__initials"
        :class="{ loading: entry?.status === 'loading' }"
    />
  </span>
</template>

<style scoped lang="scss">
.contact-avatar {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  border-radius: 50%;
  overflow: hidden;
  background: var(--surface-ground);
}

.contact-avatar__image {
  display: block;
  width: 100%;
  height: 100%;
  cursor: zoom-in;

  :deep(.contact-avatar__img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  :deep(.p-image-preview-indicator) {
    border-radius: 50%;
  }

  :deep(.p-image-preview-indicator .p-icon),
  :deep(.p-image-preview-indicator i) {
    width: 0.9rem;
    height: 0.9rem;
    font-size: 0.9rem;
  }
}

.contact-avatar__initials {
  width: 100%;
  height: 100%;
  font-size: 0.8rem;
  background: var(--primary-color);
  color: var(--primary-color-text);

  &.loading {
    opacity: 0.7;
  }
}
</style>
