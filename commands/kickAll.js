function normaliseJid(jid) {
    if (!jid) return jid;
    let [user, domain] = jid.split('@');
    if (user.includes(':')) user = user.split(':')[0];
    return `${user}@s.whatsapp.net`;
}

async function kickAllCommand(sock, chatId, message, senderId) {
    try {
        if (!chatId.endsWith('@g.us')) {
            await sock.sendMessage(chatId, { text: '🚫 This command only works in groups.' }, { quoted: message });
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return;
        }

        const metadata = await sock.groupMetadata(chatId);
        const participants = metadata.participants || [];

        const botJid = normaliseJid(sock.user.id);
        const senderNormalised = normaliseJid(senderId);

        // Admin checks using direct property
        const isBotAdmin = participants.some(p => normaliseJid(p.id) === botJid && p.admin);
        const isSenderAdmin = participants.some(p => normaliseJid(p.id) === senderNormalised && p.admin);

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

        // Build target list: exclude bot, sender, and admins (p.admin is truthy)
        const targets = participants
            .filter(p => {
                const normId = normaliseJid(p.id);
                return normId !== botJid &&
                       normId !== senderNormalised &&
                       !p.admin;   // p.admin is null/undefined for non‑admins
            })
            .map(p => p.id);

        if (targets.length === 0) {
            await sock.sendMessage(chatId, { text: '⚠️ No non‑admin members to kick.' }, { quoted: message });
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return;
        }

        await sock.sendMessage(chatId, { text: `🔄 Kicking ${targets.length} member(s)...` }, { quoted: message });

        try {
            await sock.groupParticipantsUpdate(chatId, targets, 'remove');
            await sock.sendMessage(chatId, { text: `✅ Successfully kicked ${targets.length} member(s).` }, { quoted: message });
            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
        } catch (kickErr) {
            console.error('Bulk kick failed:', kickErr);
            await sock.sendMessage(chatId, { text: `❌ Failed to kick members: ${kickErr.message}` }, { quoted: message });
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        }
    } catch (err) {
        console.error('Error in kickAllCommand:', err);
        await sock.sendMessage(chatId, { text: '❌ An unexpected error occurred.' }, { quoted: message });
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
    }
}

module.exports = kickAllCommand;
