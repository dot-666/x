const { isAdmin } = require('../lib/isAdmin'); // keep import if needed elsewhere

/**
 * Normalise a JID by stripping device suffix and ensuring correct domain.
 * @param {string} jid - The raw JID (e.g., "123...:5@s.whatsapp.net")
 * @returns {string} - Normalised JID (e.g., "123...@s.whatsapp.net")
 */
function normaliseJid(jid) {
    if (!jid) return jid;
    // Remove everything after ':' (including ':') and ensure domain
    let [user, domain] = jid.split('@');
    if (user.includes(':')) user = user.split(':')[0];
    return `${user}@s.whatsapp.net`;
}

/**
 * Check if a given JID is an admin in the group.
 * @param {Array} participants - Group participants list from metadata.
 * @param {string} jid - JID to check (will be normalised).
 * @returns {boolean}
 */
function isGroupAdmin(participants, jid) {
    const normalisedJid = normaliseJid(jid);
    const participant = participants.find(p => normaliseJid(p.id) === normalisedJid);
    return !!(participant && (participant.admin === 'admin' || participant.admin === 'superadmin'));
}

async function kickAllCommand(sock, chatId, message, senderId) {
    try {
        const isGroup = chatId.endsWith('@g.us');
        if (!isGroup) {
            await sock.sendMessage(chatId, { text: '🚫 This command only works in groups.' }, { quoted: message });
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return;
        }

        // Fetch group metadata
        const metadata = await sock.groupMetadata(chatId);
        const participants = metadata.participants || [];

        // Normalise bot's JID (from sock.user.id) and sender's JID
        const botRawJid = sock.user.id;
        const botJid = normaliseJid(botRawJid);
        const senderNormalised = normaliseJid(senderId);

        // Admin checks using normalised JIDs
        const isSenderAdmin = isGroupAdmin(participants, senderNormalised);
        const isBotAdmin = isGroupAdmin(participants, botJid);

        if (!isBotAdmin) {
            await sock.sendMessage(chatId, { text: '🚫 I need to be an admin to kick members.' }, { quoted: message });
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return;
        }

        if (!isSenderAdmin) {
            await sock.sendMessage(chatId, { text: '🚫 Only group admins can use the .kickall command.' }, { quoted: message });
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return;
        }

        // Build list of targets: exclude bot, sender, and all admins
        const targets = participants
            .filter(p => {
                const participantJid = normaliseJid(p.id);
                return participantJid !== botJid &&
                       participantJid !== senderNormalised &&
                       !isGroupAdmin(participants, participantJid); // exclude admins
            })
            .map(p => p.id); // use original ID for API call (Baileys handles it)

        if (targets.length === 0) {
            await sock.sendMessage(chatId, { text: '⚠️ No non-admin members to kick.' }, { quoted: message });
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return;
        }

        // Send processing message
        await sock.sendMessage(chatId, { text: `🔄 Attempting to kick ${targets.length} member(s)...` }, { quoted: message });

        // --- Kick all in one payload ---
        try {
            await sock.groupParticipantsUpdate(chatId, targets, 'remove');
            // If we reach here, the API call succeeded (assume all were kicked)
            await sock.sendMessage(chatId, { text: `✅ Successfully kicked ${targets.length} member(s) from the group.` }, { quoted: message });
            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
        } catch (kickError) {
            console.error('❌ Bulk kick failed:', kickError);
            // Optionally, you could fall back to sequential kicking here
            await sock.sendMessage(chatId, { text: `❌ Failed to kick members: ${kickError.message}` }, { quoted: message });
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        }

    } catch (err) {
        console.error('❌ Error in kickAllCommand:', err);
        await sock.sendMessage(chatId, { text: '❌ An unexpected error occurred.' }, { quoted: message });
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
    }
}

module.exports = kickAllCommand;
