export interface VCardPhone {
    number: string
    /** WhatsApp id (digits only) when the contact is on WhatsApp */
    waid?: string
    type?: string
}

export interface VCardContact {
    name: string
    org?: string
    phones: VCardPhone[]
    emails: string[]
}

function unescapeValue(value: string): string {
    return value
        .replace(/\\n/gi, '\n')
        .replace(/\\([,;\\])/g, '$1')
        .trim()
}

/**
 * Minimal vCard 3/4 parser - enough to show a WhatsApp contact card.
 */
export function parseVCard(raw: string | null | undefined, fallbackName = ''): VCardContact {
    const contact: VCardContact = {name: '', phones: [], emails: []}
    if (!raw) {
        contact.name = fallbackName
        return contact
    }
    // Unfold continuation lines (RFC 6350 3.2)
    const lines = String(raw).replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
    let structuredName = ''
    for (const line of lines) {
        const separator = line.indexOf(':')
        if (separator <= 0) {
            continue
        }
        const head = line.slice(0, separator)
        const value = unescapeValue(line.slice(separator + 1))
        const [rawKey, ...params] = head.split(';')
        // "item1.TEL" -> "TEL"
        const key = rawKey.split('.').pop()!.toUpperCase()
        const paramMap: Record<string, string> = {}
        for (const param of params) {
            const [name, paramValue = ''] = param.split('=')
            paramMap[name.toLowerCase()] = paramValue.replace(/^"|"$/g, '')
        }
        switch (key) {
            case 'FN':
                contact.name = value
                break
            case 'N':
                structuredName = value.split(';').filter(Boolean).reverse().join(' ')
                break
            case 'ORG':
                contact.org = value.split(';').filter(Boolean).join(', ')
                break
            case 'X-WA-BIZ-NAME':
                contact.org = contact.org || value
                break
            case 'TEL':
                if (value || paramMap.waid) {
                    contact.phones.push({
                        number: value || `+${paramMap.waid}`,
                        waid: paramMap.waid || undefined,
                        type: paramMap.type?.toLowerCase(),
                    })
                }
                break
            case 'EMAIL':
                if (value) {
                    contact.emails.push(value)
                }
                break
        }
    }
    contact.name = contact.name || structuredName || fallbackName || contact.phones[0]?.number || ''
    return contact
}
