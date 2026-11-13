<script setup>
/**
 * All contacts + members of all groups: browse, search, filter, open a chat
 * and export (CSV for Excel, vCard for phones / Google Contacts, JSON).
 */
import {useI18n} from "vue-i18n";
import {useToast} from "primevue/usetoast";
import ContactAvatar from "./ContactAvatar.vue";
import {
  buildMembers,
  downloadText,
  exportFileName,
  fetchAllPages,
  formatPhone,
  isLid,
  mapLimit,
  normalizeContacts,
  normalizeGroups,
  toCsv,
  toVCards,
} from "../../utils/chat/contacts";

const props = defineProps({
  serverId: String,
  sessionName: String,
})
const emit = defineEmits(['open-chat'])
const visible = defineModel('visible')

const {t, locale} = useI18n()
const toast = useToast()
const store = useServerStore()
const dir = computed(() => ['fa', 'ar'].includes(locale.value) ? 'rtl' : 'ltr')

const activeTab = ref(0)

function errorText(e) {
  return e?.response?.data?.message || e?.message || String(e)
}

async function copyText(text, count) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({severity: 'success', summary: t('contacts.copied', {count}), life: 2500})
  } catch (e) {
    console.warn('Clipboard is not available', e)
  }
}

function openChat(row) {
  const id = row.phone ? `${row.phone}@c.us` : row.id
  emit('open-chat', {id, name: row.displayName})
  visible.value = false
}

//
// Contacts
//
const contacts = ref([])
const contactsLoaded = ref(false)
const contactsLoading = ref(false)
const contactsProgress = ref(0)
const contactsError = ref(null)
const contactsSearch = ref('')
const contactsFilter = ref('all')
const selectedContacts = ref([])

const contactFilters = computed(() => [
  {value: 'all', label: t('contacts.filter.all')},
  {value: 'saved', label: t('contacts.filter.saved')},
  {value: 'business', label: t('contacts.filter.business')},
  {value: 'blocked', label: t('contacts.filter.blocked')},
  {value: 'hidden', label: t('contacts.filter.hidden')},
])

async function loadContacts(silent = false) {
  if (contactsLoading.value) return
  contactsLoading.value = true
  contactsProgress.value = 0
  contactsError.value = null
  try {
    const raw = await fetchAllPages(
        (limit, offset) => store.getAllContacts(props.serverId, props.sessionName, limit, offset),
        (item) => typeof item?.id === 'string' ? item.id : (item?.id?._serialized || item?.JID || ''),
        (count) => contactsProgress.value = count,
    )
    contacts.value = normalizeContacts(raw)
    contactsLoaded.value = true
    selectedContacts.value = []
  } catch (e) {
    contactsError.value = errorText(e)
    if (!silent) {
      toast.add({severity: 'error', summary: t('contacts.loadFailed'), detail: contactsError.value, life: 6000})
    }
  } finally {
    contactsLoading.value = false
  }
}

const contactStats = computed(() => ({
  total: contacts.value.length,
  saved: contacts.value.filter((c) => c.saved).length,
  business: contacts.value.filter((c) => c.business).length,
  hidden: contacts.value.filter((c) => !c.phone).length,
}))

function matches(search, ...values) {
  if (!search) return true
  const needle = search.toLowerCase().replace(/[\s+()-]/g, '')
  return values.some((value) => String(value || '').toLowerCase().replace(/[\s+()-]/g, '').includes(needle))
}

const visibleContacts = computed(() => contacts.value.filter((contact) => {
  switch (contactsFilter.value) {
    case 'saved':
      if (!contact.saved) return false
      break
    case 'business':
      if (!contact.business) return false
      break
    case 'blocked':
      if (!contact.blocked) return false
      break
    case 'hidden':
      if (contact.phone) return false
      break
  }
  return matches(contactsSearch.value, contact.displayName, contact.name, contact.pushName, contact.businessName, contact.phone, contact.id)
}))

const contactsScope = computed(() => selectedContacts.value.length ? selectedContacts.value : visibleContacts.value)

function exportContacts(format) {
  const rows = contactsScope.value
  if (!rows.length) return
  const base = 'whatsapp-contacts'
  if (format === 'csv') {
    const csv = toCsv(
        ['name', 'push_name', 'business_name', 'phone', 'whatsapp_id', 'lid', 'saved', 'business', 'blocked'],
        rows.map((c) => [c.name, c.pushName, c.businessName, formatPhone(c.phone), c.id, c.lid, c.saved, c.business, c.blocked]),
        [3],
    )
    downloadText(csv, exportFileName(base, props.sessionName, 'csv'), 'text/csv')
  } else if (format === 'vcf') {
    const entries = rows.filter((c) => c.phone).map((c) => ({name: c.displayName, phone: c.phone, org: c.businessName}))
    downloadText(toVCards(entries), exportFileName(base, props.sessionName, 'vcf'), 'text/vcard')
    notifySkipped(rows.length - entries.length)
  } else {
    downloadText(JSON.stringify(rows, null, 2), exportFileName(base, props.sessionName, 'json'), 'application/json')
  }
  toast.add({severity: 'success', summary: t('contacts.exported', {count: rows.length}), life: 2500})
}

function notifySkipped(count) {
  if (count > 0) {
    toast.add({severity: 'warn', summary: t('contacts.vcardSkipped', {count}), life: 5000})
  }
}

const contactsExportItems = computed(() => [
  {label: t('contacts.export.vcf'), icon: 'pi pi-id-card', command: () => exportContacts('vcf')},
  {label: t('contacts.export.json'), icon: 'pi pi-code', command: () => exportContacts('json')},
  {separator: true},
  {
    label: t('contacts.copyNumbers'),
    icon: 'pi pi-copy',
    command: () => {
      const phones = contactsScope.value.filter((c) => c.phone).map((c) => formatPhone(c.phone))
      copyText(phones.join('\n'), phones.length)
    },
  },
])

//
// Group members
//
const groups = ref([])
const groupsLoading = ref(false)
const groupsLoaded = ref(false)
const selectedGroups = ref([])
const resolveHidden = ref(true)
const onePerPerson = ref(true)

const membersLoading = ref(false)
const membersProgress = ref({done: 0, total: 0, failed: 0})
const memberResults = ref([])
const lidMap = ref(new Map())
const membersSearch = ref('')
const adminsOnly = ref(false)
const selectedMembers = ref([])
let cancelled = false

async function loadGroups() {
  if (groupsLoading.value) return
  groupsLoading.value = true
  try {
    const fetchPage = async (limit, offset) => {
      try {
        return await store.getGroups(props.serverId, props.sessionName, limit, offset, true)
      } catch (e) {
        // Older WAHA versions don't know "exclude" - retry without it
        if (e?.response?.status === 400) return store.getGroups(props.serverId, props.sessionName, limit, offset, false)
        throw e
      }
    }
    const raw = await fetchAllPages(fetchPage, (item) => typeof item?.id === 'string' ? item.id : (item?.id?._serialized || item?.JID || ''))
    groups.value = normalizeGroups(raw)
    groupsLoaded.value = true
  } catch (e) {
    toast.add({severity: 'error', summary: t('contacts.groupsLoadFailed'), detail: errorText(e), life: 6000})
  } finally {
    groupsLoading.value = false
  }
}

async function loadLidMap() {
  try {
    const raw = await fetchAllPages(
        (limit, offset) => store.getLids(props.serverId, props.sessionName, limit, offset),
        (item) => item?.lid || '',
        undefined,
        1000,
    )
    lidMap.value = new Map(raw.filter((item) => item?.lid && item?.pn).map((item) => [item.lid, item.pn]))
  } catch (e) {
    console.warn('Failed to load lid mappings', e)
  }
}

async function loadMembers() {
  const targets = selectedGroups.value.length ? selectedGroups.value : groups.value
  if (!targets.length || membersLoading.value) return
  cancelled = false
  membersLoading.value = true
  selectedMembers.value = []
  membersProgress.value = {done: 0, total: targets.length, failed: 0}
  try {
    // Names for members come from the address book
    if (!contactsLoaded.value) loadContacts(true)
    const results = await mapLimit(
        targets,
        4,
        async (group) => ({group, participants: await store.getGroupParticipants(props.serverId, props.sessionName, group.id)}),
        (done) => membersProgress.value = {...membersProgress.value, done},
        () => cancelled,
    )
    const ok = results.filter((result) => result.ok).map((result) => result.value)
    membersProgress.value = {...membersProgress.value, failed: results.length - ok.length}
    const needsLids = ok.some(({participants}) => (participants || []).some((p) => isLid(p?.id) && !p?.pn))
    if (resolveHidden.value && needsLids) await loadLidMap()
    memberResults.value = ok
    if (results.length - ok.length > 0) {
      toast.add({severity: 'warn', summary: t('contacts.someGroupsFailed', {count: results.length - ok.length}), life: 5000})
    }
  } finally {
    membersLoading.value = false
  }
}

function cancelMembers() {
  cancelled = true
}

const contactNames = computed(() => {
  const map = new Map()
  for (const contact of contacts.value) {
    if (contact.phone) map.set(contact.phone, contact.displayName)
    map.set(contact.id, contact.displayName)
    if (contact.lid) map.set(contact.lid, contact.displayName)
  }
  return map
})

const members = computed(() => buildMembers(
    memberResults.value,
    lidMap.value,
    (phone, id) => {
      const name = contactNames.value.get(phone) || contactNames.value.get(id)
      // A contact without a name falls back to "+phone" - prefer the real name only
      return name && name !== formatPhone(phone) ? name : ''
    },
))

const memberStats = computed(() => ({
  people: members.value.length,
  admins: members.value.filter((m) => ['admin', 'superadmin'].includes(m.role)).length,
  hidden: members.value.filter((m) => !m.phone).length,
  groups: memberResults.value.length,
}))

const visibleMembers = computed(() => members.value.filter((member) => {
  if (adminsOnly.value && !['admin', 'superadmin'].includes(member.role)) return false
  return matches(membersSearch.value, member.displayName, member.phone, member.id, member.lid, ...member.groups.map((g) => g.name))
}))

const membersScope = computed(() => selectedMembers.value.length ? selectedMembers.value : visibleMembers.value)

function exportMembers(format) {
  const rows = membersScope.value
  if (!rows.length) return
  const base = 'whatsapp-group-members'
  if (format === 'csv') {
    let csv
    if (onePerPerson.value) {
      csv = toCsv(
          ['name', 'phone', 'whatsapp_id', 'lid', 'role', 'groups_count', 'groups'],
          rows.map((m) => [m.displayName, formatPhone(m.phone), m.phone ? `${m.phone}@c.us` : m.id, m.lid, m.role, m.groups.length, m.groups.map((g) => g.name).join(' | ')]),
          [1],
      )
    } else {
      csv = toCsv(
          ['group', 'group_id', 'name', 'phone', 'whatsapp_id', 'lid', 'role'],
          rows.flatMap((m) => m.groups.map((g) => [g.name, g.id, m.displayName, formatPhone(m.phone), m.phone ? `${m.phone}@c.us` : m.id, m.lid, g.role])),
          [3],
      )
    }
    downloadText(csv, exportFileName(base, props.sessionName, 'csv'), 'text/csv')
  } else if (format === 'vcf') {
    const entries = rows.filter((m) => m.phone).map((m) => ({
      name: m.displayName,
      phone: m.phone,
      note: `WhatsApp: ${m.groups.map((g) => g.name).join(', ')}`,
    }))
    downloadText(toVCards(entries), exportFileName(base, props.sessionName, 'vcf'), 'text/vcard')
    notifySkipped(rows.length - entries.length)
  } else {
    downloadText(JSON.stringify(rows, null, 2), exportFileName(base, props.sessionName, 'json'), 'application/json')
  }
  toast.add({severity: 'success', summary: t('contacts.exported', {count: rows.length}), life: 2500})
}

const membersExportItems = computed(() => [
  {label: t('contacts.export.vcf'), icon: 'pi pi-id-card', command: () => exportMembers('vcf')},
  {label: t('contacts.export.json'), icon: 'pi pi-code', command: () => exportMembers('json')},
  {separator: true},
  {
    label: t('contacts.copyNumbers'),
    icon: 'pi pi-copy',
    command: () => {
      const phones = membersScope.value.filter((m) => m.phone).map((m) => formatPhone(m.phone))
      copyText(phones.join('\n'), phones.length)
    },
  },
])

function roleSeverity(role) {
  if (role === 'superadmin') return 'danger'
  if (role === 'admin') return 'warning'
  if (role === 'left') return 'secondary'
  return 'info'
}

function roleLabel(role) {
  switch (role) {
    case 'superadmin':
      return t('contacts.role.superadmin')
    case 'admin':
      return t('contacts.role.admin')
    case 'left':
      return t('contacts.role.left')
    default:
      return t('contacts.role.participant')
  }
}

//
// Lifecycle
//
watch(visible, (isVisible) => {
  if (!isVisible) {
    cancelled = true
    return
  }
  if (!contactsLoaded.value) loadContacts()
})

watch(activeTab, (tab) => {
  if (tab === 1 && !groupsLoaded.value) loadGroups()
})

watch(() => [props.serverId, props.sessionName], () => {
  contacts.value = []
  contactsLoaded.value = false
  groups.value = []
  groupsLoaded.value = false
  selectedGroups.value = []
  memberResults.value = []
  lidMap.value = new Map()
})

const membersPercent = computed(() => {
  const {done, total} = membersProgress.value
  return total ? Math.round(done * 100 / total) : 0
})
</script>

<template>
  <Dialog
      v-model:visible="visible"
      modal
      maximizable
      dismissableMask
      class="chat-popup"
      :style="{ width: 'min(1200px, 94vw)', height: '88vh' }"
      :contentStyle="{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }"
  >
    <template #header>
      <div class="flex align-items-center gap-2 font-bold text-xl">
        <i class="pi pi-users"></i>
        <span>{{ t('contacts.title') }}</span>
      </div>
    </template>

    <div class="chat-ui contacts-root" :dir="dir">
      <TabView v-model:activeIndex="activeTab" class="contacts-tabs">
        <!-- Contacts -->
        <TabPanel>
          <template #header>
            <i class="pi pi-book mx-2"></i>
            <span>{{ t('contacts.tab.contacts') }}</span>
            <Badge v-if="contactsLoaded" :value="contacts.length" class="mx-2"/>
          </template>

          <div class="toolbar">
            <IconField iconPosition="left" class="search">
              <InputIcon class="pi pi-search"/>
              <InputText v-model="contactsSearch" :placeholder="t('contacts.search')" class="w-full"/>
            </IconField>
            <SelectButton
                v-model="contactsFilter"
                :options="contactFilters"
                optionLabel="label"
                optionValue="value"
                :allowEmpty="false"
                class="filters"
            />
            <div class="actions">
              <Button
                  icon="pi pi-refresh"
                  text
                  rounded
                  :loading="contactsLoading"
                  v-tooltip.bottom="t('contacts.reload')"
                  :aria-label="t('contacts.reload')"
                  @click="loadContacts()"
              />
              <SplitButton
                  :label="selectedContacts.length ? t('contacts.exportSelected', {count: selectedContacts.length}) : t('contacts.exportCsv', {count: visibleContacts.length})"
                  icon="pi pi-file-excel"
                  :model="contactsExportItems"
                  :disabled="!visibleContacts.length"
                  @click="exportContacts('csv')"
              />
            </div>
          </div>

          <div v-if="contactsLoaded" class="stats">
            <Tag severity="info" :value="t('contacts.stats.total', {count: contactStats.total})"/>
            <Tag severity="success" :value="t('contacts.stats.saved', {count: contactStats.saved})"/>
            <Tag severity="warning" :value="t('contacts.stats.business', {count: contactStats.business})"/>
            <Tag severity="secondary" :value="t('contacts.stats.hidden', {count: contactStats.hidden})"/>
          </div>

          <div v-if="contactsLoading" class="loading-line">
            <ProgressBar mode="indeterminate" style="height: 4px"/>
            <small>{{ t('contacts.loadingCount', {count: contactsProgress}) }}</small>
          </div>

          <Message v-if="contactsError && !contactsLoading" severity="warn" :closable="false">
            <div>{{ contactsError }}</div>
            <div class="text-sm mt-1">{{ t('contacts.storeHint') }}</div>
          </Message>

          <DataTable
              v-model:selection="selectedContacts"
              :value="visibleContacts"
              dataKey="id"
              paginator
              :rows="50"
              :rowsPerPageOptions="[25, 50, 100, 250]"
              scrollable
              scrollHeight="flex"
              class="contacts-table"
              size="small"
              stripedRows
              sortField="displayName"
              :sortOrder="1"
          >
            <template #empty>
              <div class="empty">{{ contactsLoading ? t('contacts.loading') : t('contacts.empty') }}</div>
            </template>
            <Column selectionMode="multiple" headerStyle="width: 3rem"/>
            <Column field="displayName" :header="t('contacts.column.name')" sortable>
              <template #body="{ data }">
                <div class="person">
                  <ContactAvatar
                      :serverId="serverId"
                      :sessionName="sessionName"
                      :id="data.phone ? `${data.phone}@c.us` : data.id"
                      :name="data.displayName"
                  />
                  <div class="person-text">
                    <div class="font-medium" dir="auto">{{ data.displayName }}</div>
                    <div v-if="data.pushName && data.pushName !== data.displayName" class="secondary" dir="auto">~{{ data.pushName }}</div>
                  </div>
                </div>
              </template>
            </Column>
            <Column field="phone" :header="t('contacts.column.phone')" sortable>
              <template #body="{ data }">
                <span v-if="data.phone" dir="ltr" class="phone">{{ formatPhone(data.phone) }}</span>
                <Tag v-else severity="secondary" :value="t('contacts.hiddenNumber')" v-tooltip.top="data.id"/>
              </template>
            </Column>
            <Column :header="t('contacts.column.info')">
              <template #body="{ data }">
                <div class="flex flex-wrap gap-1">
                  <Tag v-if="data.isMe" severity="info" :value="t('contacts.tag.me')"/>
                  <Tag v-if="data.saved" severity="success" :value="t('contacts.tag.saved')"/>
                  <Tag v-if="data.business" severity="warning" :value="data.businessName || t('contacts.tag.business')"/>
                  <Tag v-if="data.blocked" severity="danger" :value="t('contacts.tag.blocked')"/>
                </div>
              </template>
            </Column>
            <Column headerStyle="width: 6rem">
              <template #body="{ data }">
                <div class="row-actions">
                  <Button icon="pi pi-comments" text rounded size="small" v-tooltip.top="t('contacts.openChat')" :aria-label="t('contacts.openChat')" @click="openChat(data)"/>
                  <Button v-if="data.phone" icon="pi pi-copy" text rounded size="small" v-tooltip.top="t('contacts.copyNumber')" :aria-label="t('contacts.copyNumber')" @click="copyText(formatPhone(data.phone), 1)"/>
                </div>
              </template>
            </Column>
          </DataTable>
        </TabPanel>

        <!-- Group members -->
        <TabPanel>
          <template #header>
            <i class="pi pi-users mx-2"></i>
            <span>{{ t('contacts.tab.members') }}</span>
            <Badge v-if="members.length" :value="members.length" class="mx-2"/>
          </template>

          <div class="toolbar">
            <MultiSelect
                v-model="selectedGroups"
                :options="groups"
                optionLabel="name"
                filter
                display="chip"
                :maxSelectedLabels="3"
                :loading="groupsLoading"
                :placeholder="t('contacts.allGroups', {count: groups.length})"
                :selectedItemsLabel="t('contacts.groupsSelected', {count: selectedGroups.length})"
                class="groups-select"
                panelClass="chat-popup"
            >
              <template #option="{ option }">
                <div class="flex align-items-center justify-content-between gap-3 w-full">
                  <span dir="auto">{{ option.name }}</span>
                  <small v-if="option.size" class="secondary">{{ t('contacts.membersCount', {count: option.size}) }}</small>
                </div>
              </template>
            </MultiSelect>
            <div class="options">
              <label class="option">
                <InputSwitch v-model="resolveHidden"/>
                <span v-tooltip.bottom="t('contacts.resolveHiddenTooltip')">{{ t('contacts.resolveHidden') }}</span>
              </label>
              <label class="option">
                <InputSwitch v-model="onePerPerson"/>
                <span v-tooltip.bottom="t('contacts.onePerPersonTooltip')">{{ t('contacts.onePerPerson') }}</span>
              </label>
            </div>
            <div class="actions">
              <Button
                  v-if="!membersLoading"
                  :label="selectedGroups.length ? t('contacts.loadMembersSelected', {count: selectedGroups.length}) : t('contacts.loadMembersAll', {count: groups.length})"
                  icon="pi pi-download"
                  :disabled="!groups.length"
                  @click="loadMembers"
              />
              <Button v-else :label="t('contacts.cancel')" icon="pi pi-times" severity="secondary" @click="cancelMembers"/>
            </div>
          </div>

          <div v-if="membersLoading || membersProgress.total" class="loading-line">
            <ProgressBar :value="membersPercent" style="height: 1.1rem"/>
            <small>
              {{ t('contacts.groupsProgress', {done: membersProgress.done, total: membersProgress.total}) }}
              <template v-if="membersProgress.failed"> • {{ t('contacts.groupsFailed', {count: membersProgress.failed}) }}</template>
            </small>
          </div>

          <template v-if="memberResults.length">
            <div class="toolbar">
              <IconField iconPosition="left" class="search">
                <InputIcon class="pi pi-search"/>
                <InputText v-model="membersSearch" :placeholder="t('contacts.searchMembers')" class="w-full"/>
              </IconField>
              <label class="option">
                <InputSwitch v-model="adminsOnly"/>
                <span>{{ t('contacts.adminsOnly') }}</span>
              </label>
              <div class="actions">
                <SplitButton
                    :label="selectedMembers.length ? t('contacts.exportSelected', {count: selectedMembers.length}) : t('contacts.exportCsv', {count: visibleMembers.length})"
                    icon="pi pi-file-excel"
                    :model="membersExportItems"
                    :disabled="!visibleMembers.length"
                    @click="exportMembers('csv')"
                />
              </div>
            </div>
            <div class="stats">
              <Tag severity="info" :value="t('contacts.stats.people', {count: memberStats.people})"/>
              <Tag severity="warning" :value="t('contacts.stats.admins', {count: memberStats.admins})"/>
              <Tag severity="secondary" :value="t('contacts.stats.hidden', {count: memberStats.hidden})"/>
              <Tag severity="success" :value="t('contacts.stats.groups', {count: memberStats.groups})"/>
            </div>
          </template>

          <DataTable
              v-if="memberResults.length || membersLoading"
              v-model:selection="selectedMembers"
              :value="visibleMembers"
              dataKey="key"
              paginator
              :rows="50"
              :rowsPerPageOptions="[25, 50, 100, 250]"
              scrollable
              scrollHeight="flex"
              class="contacts-table"
              size="small"
              stripedRows
          >
            <template #empty>
              <div class="empty">{{ membersLoading ? t('contacts.loading') : t('contacts.empty') }}</div>
            </template>
            <Column selectionMode="multiple" headerStyle="width: 3rem"/>
            <Column field="displayName" :header="t('contacts.column.name')" sortable>
              <template #body="{ data }">
                <div class="person">
                  <ContactAvatar
                      :serverId="serverId"
                      :sessionName="sessionName"
                      :id="data.phone ? `${data.phone}@c.us` : data.id"
                      :name="data.displayName"
                  />
                  <span class="font-medium" dir="auto">{{ data.displayName }}</span>
                </div>
              </template>
            </Column>
            <Column field="phone" :header="t('contacts.column.phone')" sortable>
              <template #body="{ data }">
                <span v-if="data.phone" dir="ltr" class="phone">{{ formatPhone(data.phone) }}</span>
                <Tag v-else severity="secondary" :value="t('contacts.hiddenNumber')" v-tooltip.top="data.id"/>
              </template>
            </Column>
            <Column field="role" :header="t('contacts.column.role')" sortable>
              <template #body="{ data }">
                <Tag :severity="roleSeverity(data.role)" :value="roleLabel(data.role)"/>
              </template>
            </Column>
            <Column field="groups.length" :header="t('contacts.column.groups')" sortable>
              <template #body="{ data }">
                <div class="groups-cell" v-tooltip.top="data.groups.map((g) => g.name).join('\n')">
                  <Chip v-for="group in data.groups.slice(0, 2)" :key="group.id" :label="group.name" class="group-chip"/>
                  <span v-if="data.groups.length > 2" class="secondary">+{{ data.groups.length - 2 }}</span>
                </div>
              </template>
            </Column>
            <Column headerStyle="width: 6rem">
              <template #body="{ data }">
                <div class="row-actions">
                  <Button icon="pi pi-comments" text rounded size="small" v-tooltip.top="t('contacts.openChat')" :aria-label="t('contacts.openChat')" @click="openChat(data)"/>
                  <Button v-if="data.phone" icon="pi pi-copy" text rounded size="small" v-tooltip.top="t('contacts.copyNumber')" :aria-label="t('contacts.copyNumber')" @click="copyText(formatPhone(data.phone), 1)"/>
                </div>
              </template>
            </Column>
          </DataTable>

          <div v-else-if="!membersLoading" class="intro">
            <i class="pi pi-users"></i>
            <div>{{ t('contacts.membersIntro') }}</div>
          </div>
        </TabPanel>
      </TabView>
    </div>
  </Dialog>
</template>

<style scoped lang="scss">
.contacts-root {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.contacts-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;

  :deep(.p-tabview-panels) {
    flex: 1;
    min-height: 0;
    padding: 0.75rem 0 0;
    display: flex;
    flex-direction: column;
  }

  :deep(.p-tabview-panel) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
}

.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.search {
  flex: 1;
  min-width: 14rem;
}

.filters :deep(.p-button) {
  padding: 0.45rem 0.75rem;
  font-size: 0.85rem;
}

.actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-inline-start: auto;
}

.options {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  cursor: pointer;
}

.groups-select {
  flex: 1;
  min-width: 16rem;
  max-width: 32rem;
}

.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.loading-line {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  color: var(--text-color-secondary);
}

.contacts-table {
  flex: 1;
  min-height: 0;
}

.person {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.person-text {
  min-width: 0;
}

.secondary {
  font-size: 0.78rem;
  color: var(--text-color-secondary);
}

.phone {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.row-actions {
  display: flex;
  gap: 0.1rem;
}

.groups-cell {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.group-chip {
  font-size: 0.75rem;
  padding: 0 0.5rem;
  max-width: 12rem;

  :deep(.p-chip-text) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0.2rem 0;
  }
}

.empty, .intro {
  padding: 2rem;
  text-align: center;
  color: var(--text-color-secondary);
}

.intro {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  max-width: 32rem;
  line-height: 1.5;

  i {
    font-size: 2.5rem;
    opacity: 0.6;
  }
}
</style>
