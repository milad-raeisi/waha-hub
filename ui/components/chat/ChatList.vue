<script setup>
const props = defineProps({
      chats: Array,
      pending: Boolean,
      merge: {
        type: Boolean,
        default: true,
      },
      loadMoreChats: Function,
      loadingMoreChats: Boolean,
      serverId: String,
      sessionName: String,
      selectedChatId: String,
    }
)

function rowClass(data) {
  return data.id === props.selectedChatId ? 'chat-row-selected' : undefined
}
const emit = defineEmits(['clickOnChat',
  'refreshChats',
  'update:merge'
])

</script>

<template>
  <div style="width: 100%; height: 100%; overflow: auto; display: flex; flex-direction: column;">
    <DataTable
        :value="chats"
        :loading="pending"
        style="width: 100%"
        class="p-datatable--clickable"
        :rowClass="rowClass"
        @row-click="emit('clickOnChat', $event.data)"
        :rowHover="true"
    >
      <Column>
        <template #header>
          <div class="w-full flex align-items-center gap-3 flex-wrap justify-content-between">
            <div class="flex align-items-center gap-2">
              <div>
                {{ $t('chat.last20Chats') }}
              </div>
              <RefreshButton
                  @click="emit('refreshChats')"
                  :refreshing="pending"
              ></RefreshButton>
            </div>
            <div
                class="flex align-items-center gap-2 ml-auto"
                v-tooltip.bottom="$t('chat.mergeToggleTooltip')"
            >
              <i class="pi pi-object-ungroup text-sm"></i>
              <span class="font-medium text-sm">{{ $t('chat.mergeToggleLabel') }}</span>
              <InputSwitch
                  :modelValue="props.merge"
                  @update:modelValue="value => emit('update:merge', value)"
              />
            </div>
          </div>
        </template>
        <template #body="{ data }">
          <ChatPreview
              :id="data.id"
              :name="data.name"
              :picture="data.picture"
              :message="data.lastMessage"
              :serverId="serverId"
              :sessionName="sessionName"
          />
        </template>
      </Column>
    </DataTable>
    <div class="flex justify-content-center py-5">
      <Button
          :label="$t('chat.showMoreChats')"
          icon="pi pi-arrow-down"
          size="small"
          outlined
          :loading="loadingMoreChats"
          @click="loadMoreChats"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
:deep(.chat-row-selected) {
  background: var(--highlight-bg) !important;
  box-shadow: inset 3px 0 0 var(--primary-color);
}

[dir='rtl'] :deep(.chat-row-selected) {
  box-shadow: inset -3px 0 0 var(--primary-color);
}
</style>
