<script setup>
import {useI18n} from "vue-i18n";
import {formatMessageText, isEmojiOnly} from "../../../utils/chat/format";

const props = defineProps({
  text: String,
  /** Allow the big-emoji style (only for messages without media) */
  allowJumbo: Boolean,
  /** Number -> name, to render @mentions */
  mentions: Object,
  /** Reserve room (rem) at the end of the last line for the time / ack overlay */
  spacer: Number,
})
const {t} = useI18n()

const LIMIT = 1200
const expanded = ref(false)
const isLong = computed(() => (props.text || '').length > LIMIT + 200)
const visibleText = computed(() => {
  if (!isLong.value || expanded.value) return props.text || ''
  return (props.text || '').slice(0, LIMIT).replace(/\s+\S*$/, '') + '…'
})
const html = computed(() => formatMessageText(visibleText.value, {mentions: props.mentions || undefined}))
const jumbo = computed(() => props.allowJumbo && isEmojiOnly(props.text))
</script>

<template>
  <div class="message-text" :class="{ jumbo }" dir="auto">
    <span v-html="html"></span>
    <a
        v-if="isLong"
        href="#"
        class="read-more"
        @click.prevent="expanded = !expanded"
    >{{ expanded ? t('chat.message.showLess') : t('chat.message.readMore') }}</a>
    <span v-if="spacer" class="meta-spacer" :style="{ width: `${spacer}rem` }"></span>
  </div>
</template>

<style scoped lang="scss">
.message-text {
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.45;
  unicode-bidi: plaintext;

  &.jumbo {
    font-size: 2.6rem;
    line-height: 1.2;
  }

  :deep(a) {
    color: var(--primary-color);
    text-decoration: underline;
  }

  :deep(.wa-pre) {
    margin: 0.25rem 0;
    padding: 0.4rem 0.5rem;
    border-radius: 6px;
    background: var(--surface-ground);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85em;
    white-space: pre-wrap;
    unicode-bidi: plaintext;
  }

  :deep(.wa-code) {
    padding: 0 0.25rem;
    border-radius: 4px;
    background: var(--surface-ground);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85em;
  }

  :deep(.wa-quote) {
    display: inline-block;
    padding-inline-start: 0.5rem;
    border-inline-start: 3px solid var(--surface-400);
    color: var(--text-color-secondary);
  }

  :deep(.wa-mention) {
    color: var(--primary-color);
    font-weight: 500;
  }
}

.meta-spacer {
  display: inline-block;
  height: 0.8em;
  vertical-align: baseline;
}

.jumbo .meta-spacer {
  height: 0.3em;
}

.read-more {
  display: inline-block;
  margin-inline-start: 0.35rem;
  color: var(--primary-color);
  font-weight: 500;
}
</style>
