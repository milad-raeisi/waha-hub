<script setup>
import {KIND_ICONS} from "../../../utils/chat/messageParser";
import {useMessageLabels} from "../../../composables/chat/useMessageLabels";

const props = defineProps({
  /** {kind, text, thumbnail, filename} - ParsedQuote or a reply target */
  quote: Object,
  sender: String,
  color: String,
  clickable: Boolean,
})
const emit = defineEmits(['click'])
const {kindLabel} = useMessageLabels()

const icon = computed(() => props.quote?.kind && props.quote.kind !== 'text' ? KIND_ICONS[props.quote.kind] : '')
const text = computed(() => {
  const value = props.quote?.text || props.quote?.filename
  if (value) return value.length > 220 ? value.slice(0, 220) + '…' : value
  if (props.quote?.kind && props.quote.kind !== 'text') return kindLabel(props.quote.kind)
  return ''
})
</script>

<template>
  <div
      class="quote"
      :class="{ clickable }"
      :style="{ '--quote-color': color || 'var(--primary-color)' }"
      @click="clickable && emit('click')"
  >
    <div class="quote-body">
      <div v-if="sender" class="quote-sender" dir="auto">{{ sender }}</div>
      <div class="quote-text" dir="auto">
        <i v-if="icon" :class="icon" class="quote-icon"></i>
        <span>{{ text }}</span>
      </div>
    </div>
    <img v-if="quote?.thumbnail" :src="quote.thumbnail" alt="" class="quote-thumb"/>
  </div>
</template>

<style scoped lang="scss">
.quote {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
  min-width: 0;
  border-radius: 6px;
  border-inline-start: 4px solid var(--quote-color);
  background: var(--surface-ground);
  overflow: hidden;

  &.clickable {
    cursor: pointer;

    &:hover {
      filter: brightness(1.08);
    }
  }
}

.quote-body {
  flex: 1;
  min-width: 0;
  padding: 0.3rem 0.5rem;
}

.quote-sender {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--quote-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quote-text {
  font-size: 0.8rem;
  color: var(--text-color-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.quote-icon {
  font-size: 0.75rem;
  margin-inline-end: 0.25rem;
}

.quote-thumb {
  flex-shrink: 0;
  width: 3.4rem;
  height: 3.4rem;
  object-fit: cover;
}
</style>
