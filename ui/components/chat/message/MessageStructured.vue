<script setup>
/**
 * Non-media structured messages: location, contacts, poll, event, group invite, buttons/lists.
 */
import {useI18n} from "vue-i18n";
import {useToast} from "primevue/usetoast";
import MessageText from "./MessageText.vue";

const props = defineProps({
  parsed: Object,
})
const {t, locale} = useI18n()
const toast = useToast()

const location = computed(() => props.parsed.location || {})
const hasCoordinates = computed(() => Number.isFinite(location.value.latitude) && Number.isFinite(location.value.longitude))
const mapUrl = computed(() => {
  if (hasCoordinates.value) {
    return `https://www.google.com/maps/search/?api=1&query=${location.value.latitude},${location.value.longitude}`
  }
  return location.value.url || null
})
const coordinates = computed(() => hasCoordinates.value
    ? `${location.value.latitude.toFixed(5)}, ${location.value.longitude.toFixed(5)}`
    : '')

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map((part) => [...part][0]).join('').toUpperCase() || '?'
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({severity: 'success', summary: t('chat.message.copied'), detail: text, life: 2000})
  } catch (e) {
    console.warn('Clipboard is not available', e)
  }
}

const eventDate = computed(() => {
  const start = props.parsed.event?.start
  if (!start) return ''
  const date = new Date(start < 1e12 ? start * 1000 : start)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale.value || undefined, {dateStyle: 'medium', timeStyle: 'short'}).format(date)
})
</script>

<template>
  <!-- Location -->
  <a
      v-if="parsed.kind === 'location'"
      class="location"
      :href="mapUrl || undefined"
      target="_blank"
      rel="noopener noreferrer"
  >
    <img v-if="location.thumbnail" :src="location.thumbnail" alt="" class="location-map"/>
    <div v-else class="location-map location-placeholder">
      <i class="pi pi-map-marker"></i>
    </div>
    <div class="location-info">
      <div class="flex align-items-center gap-2">
        <span class="font-medium" dir="auto">{{ location.name || t('chat.kind.location') }}</span>
        <Tag v-if="location.live" severity="danger" :value="t('chat.message.liveLocation')" class="live-tag"/>
      </div>
      <div v-if="location.address" class="secondary" dir="auto">{{ location.address }}</div>
      <div v-if="coordinates" class="secondary">
        <i class="pi pi-map-marker"></i> {{ coordinates }}
      </div>
      <div v-if="mapUrl" class="link">{{ t('chat.message.openMap') }} <i class="pi pi-external-link"></i></div>
    </div>
  </a>

  <!-- Contacts -->
  <div v-else-if="parsed.kind === 'contacts'" class="contacts">
    <div v-for="(contact, index) in parsed.contacts" :key="index" class="contact">
      <Avatar :label="initials(contact.name)" shape="circle" class="contact-avatar"/>
      <div class="contact-info">
        <div class="font-medium" dir="auto">{{ contact.name }}</div>
        <div v-if="contact.org" class="secondary" dir="auto">{{ contact.org }}</div>
        <div v-for="phone in contact.phones" :key="phone.number" class="contact-line">
          <i class="pi pi-phone"></i>
          <span dir="ltr">{{ phone.number }}</span>
          <i v-if="phone.waid" class="pi pi-whatsapp wa-badge" v-tooltip.top="'WhatsApp'"></i>
          <Button
              icon="pi pi-copy"
              text
              rounded
              size="small"
              class="copy-button"
              v-tooltip.top="t('chat.message.copyNumber')"
              :aria-label="t('chat.message.copyNumber')"
              @click="copy(phone.number)"
          />
        </div>
        <div v-for="email in contact.emails" :key="email" class="contact-line">
          <i class="pi pi-envelope"></i>
          <a :href="`mailto:${email}`">{{ email }}</a>
        </div>
      </div>
    </div>
  </div>

  <!-- Poll -->
  <div v-else-if="parsed.kind === 'poll'" class="poll">
    <div class="poll-title" dir="auto">
      <i class="pi pi-chart-bar"></i>
      <span>{{ parsed.poll?.name }}</span>
    </div>
    <div class="secondary mb-2">
      {{ parsed.poll?.selectable === 1 ? t('chat.message.pollSingle') : t('chat.message.pollMultiple') }}
    </div>
    <div v-for="(option, index) in parsed.poll?.options" :key="index" class="poll-option" dir="auto">
      <i :class="parsed.poll?.selectable === 1 ? 'pi pi-circle' : 'pi pi-stop'"></i>
      <span>{{ option }}</span>
    </div>
  </div>

  <!-- Event -->
  <div v-else-if="parsed.kind === 'event'" class="card-block">
    <div class="card-icon"><i class="pi pi-calendar"></i></div>
    <div>
      <div class="font-medium" dir="auto">{{ parsed.event?.name || t('chat.kind.event') }}</div>
      <div v-if="eventDate" class="secondary"><i class="pi pi-clock"></i> {{ eventDate }}</div>
      <div v-if="parsed.event?.location" class="secondary" dir="auto">
        <i class="pi pi-map-marker"></i> {{ parsed.event.location }}
      </div>
      <MessageText v-if="parsed.event?.description" :text="parsed.event.description" class="mt-1"/>
    </div>
  </div>

  <!-- Group invite -->
  <div v-else-if="parsed.kind === 'group-invite'" class="card-block">
    <div class="card-icon"><i class="pi pi-users"></i></div>
    <div>
      <div class="font-medium" dir="auto">{{ parsed.invite?.groupName || t('chat.kind.groupInvite') }}</div>
      <div class="secondary">{{ t('chat.message.groupInvite') }}</div>
      <MessageText v-if="parsed.invite?.caption" :text="parsed.invite.caption" class="mt-1"/>
    </div>
  </div>

  <!-- Buttons / list / template -->
  <div v-else-if="parsed.kind === 'interactive'" class="interactive">
    <div v-if="parsed.interactive?.title" class="font-medium mb-1" dir="auto">{{ parsed.interactive.title }}</div>
    <MessageText v-if="parsed.text" :text="parsed.text"/>
    <div v-if="parsed.interactive?.footer" class="secondary mt-1" dir="auto">{{ parsed.interactive.footer }}</div>
    <div v-if="parsed.interactive?.buttons?.length" class="interactive-buttons">
      <div v-for="(button, index) in parsed.interactive.buttons" :key="index" class="interactive-button" dir="auto">
        {{ button }}
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.secondary {
  font-size: 0.8rem;
  color: var(--text-color-secondary);
}

.location {
  display: block;
  width: 280px;
  max-width: 100%;
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface-ground);
  color: inherit;
  text-decoration: none;
}

.location-map {
  display: block;
  width: 100%;
  height: 140px;
  object-fit: cover;
}

.location-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--red-500, #ef4444);
  background: repeating-linear-gradient(45deg, var(--surface-100), var(--surface-100) 12px, var(--surface-50) 12px, var(--surface-50) 24px);

  i {
    font-size: 2.5rem;
  }
}

.location-info {
  padding: 0.5rem 0.6rem;
  line-height: 1.4;
}

.live-tag {
  font-size: 0.65rem;
  padding: 0.1rem 0.4rem;
}

.link {
  margin-top: 0.25rem;
  font-size: 0.8rem;
  color: var(--primary-color);
}

.contacts {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 240px;
}

.contact {
  display: flex;
  gap: 0.6rem;
  padding: 0.5rem;
  border-radius: 8px;
  background: var(--surface-ground);
}

.contact-avatar {
  flex-shrink: 0;
  background: var(--primary-color);
  color: var(--primary-color-text);
}

.contact-info {
  min-width: 0;
  line-height: 1.4;
}

.contact-line {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;

  > i {
    font-size: 0.75rem;
    color: var(--text-color-secondary);
  }
}

.wa-badge {
  color: var(--green-500, #22c55e) !important;
}

.copy-button {
  width: 1.6rem !important;
  height: 1.6rem !important;
  padding: 0 !important;
}

.poll {
  min-width: 240px;
}

.poll-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 600;
  margin-bottom: 0.15rem;
}

.poll-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.6rem;
  margin-top: 0.3rem;
  border-radius: 8px;
  background: var(--surface-ground);

  i {
    font-size: 0.8rem;
    color: var(--text-color-secondary);
  }
}

.card-block {
  display: flex;
  gap: 0.6rem;
  min-width: 220px;
  line-height: 1.4;
}

.card-icon {
  flex-shrink: 0;
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-ground);
  color: var(--primary-color);

  i {
    font-size: 1.2rem;
  }
}

.interactive-buttons {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-top: 0.5rem;
}

.interactive-button {
  padding: 0.4rem 0.6rem;
  border-radius: 8px;
  border: 1px solid var(--surface-border);
  text-align: center;
  color: var(--primary-color);
  font-size: 0.85rem;
}
</style>
