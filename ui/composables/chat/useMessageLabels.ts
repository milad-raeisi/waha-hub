import {useI18n} from 'vue-i18n'

/**
 * Translated labels for message kinds and system notices.
 * Keys are spelled out (no `chat.kind.${kind}`) so scripts/check-i18n.js can see them.
 */
export function useMessageLabels() {
    const {t} = useI18n()

    function kindLabel(kind: string): string {
        switch (kind) {
            case 'image':
                return t('chat.kind.image')
            case 'video':
                return t('chat.kind.video')
            case 'gif':
                return t('chat.kind.gif')
            case 'ptv':
                return t('chat.kind.ptv')
            case 'audio':
                return t('chat.kind.audio')
            case 'voice':
                return t('chat.kind.voice')
            case 'document':
                return t('chat.kind.document')
            case 'sticker':
                return t('chat.kind.sticker')
            case 'location':
                return t('chat.kind.location')
            case 'contacts':
                return t('chat.kind.contacts')
            case 'poll':
                return t('chat.kind.poll')
            case 'event':
                return t('chat.kind.event')
            case 'group-invite':
                return t('chat.kind.groupInvite')
            case 'interactive':
                return t('chat.kind.interactive')
            case 'call':
                return t('chat.kind.call')
            case 'revoked':
                return t('chat.message.deleted')
            case 'pending':
                return t('chat.kind.pending')
            case 'system':
                return t('chat.kind.system')
            case 'text':
                return ''
            default:
                return t('chat.kind.unsupported')
        }
    }

    function systemText(key: string, params: Record<string, string>): string {
        switch (key) {
            case 'e2e':
                return t('chat.system.e2e')
            case 'disappearing':
                return t('chat.system.disappearing')
            case 'securityCode':
                return t('chat.system.securityCode')
            case 'numberChanged':
                return t('chat.system.numberChanged', params)
            case 'pinned':
                return t('chat.system.pinned')
            case 'unpinned':
                return t('chat.system.unpinned')
            case 'phoneRequest':
                return t('chat.system.phoneRequest')
            case 'group.create':
                return params.subject ? t('chat.system.groupCreate', params) : t('chat.system.groupCreated')
            case 'group.subject':
                return t('chat.system.groupSubject', params)
            case 'group.picture':
                return t('chat.system.groupPicture')
            case 'group.description':
                return t('chat.system.groupDescription')
            case 'group.inviteLink':
                return t('chat.system.groupInviteLink')
            case 'group.settings':
                return t('chat.system.groupSettings')
            case 'group.add':
                return t('chat.system.groupAdd', params)
            case 'group.remove':
                return t('chat.system.groupRemove', params)
            case 'group.leave':
                return t('chat.system.groupLeave', params)
            case 'group.promote':
                return t('chat.system.groupPromote', params)
            case 'group.demote':
                return t('chat.system.groupDemote', params)
            default:
                return t('chat.system.generic', params)
        }
    }

    return {kindLabel, systemText}
}
