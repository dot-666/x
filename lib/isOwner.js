const settings = require('../settings');
const { isSudo } = require('./index');
const { compareJids, toUserJid } = require('./jid');

async function isOwnerOrSudo(senderId) {
    try {
        if (typeof senderId !== 'string' || !senderId.trim()) {
            return false;
        }

        // Check settings.ownerNumber (single number or comma-separated list)
        const ownerRaw = settings?.ownerNumber;
        if (ownerRaw) {
            const ownerNumbers = String(ownerRaw)
                .split(',')
                .map(n => n.trim())
                .filter(Boolean);

            for (const num of ownerNumbers) {
                const ownerJid = toUserJid(num);
                if (ownerJid && compareJids(senderId, ownerJid)) {
                    return true;
                }
            }
        }

        // Check sudo list
        const sudoStatus = await isSudo(senderId);
        return Boolean(sudoStatus);
    } catch (error) {
        console.error(`[isOwnerOrSudo] Error for sender ${senderId}: ${error.message}`);
        return false;
    }
}

module.exports = isOwnerOrSudo;
