const { createFakeContact } = require('../lib/fakeContact');
function normaliseJid(jid) {
    if (!jid) return jid;
    let [user, domain] = jid.split('@');
    if (user.includes(':')) user = user.split(':')[0];
    return `${user}@s.whatsapp.net`;
}

async function kickAllCommand(sock, chatId, message, senderId) {
    try {
        if (!chatId.endsWith('@g.us')) {
            await sock.sendMessage(chatId, { text: '🚫 This command only works in groups.' }, { quoted: createFakeContact(message) });
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return;
        }

        const metadata = await sock.groupMetadata(chatId);
        const participants = metadata.participants || [];

        const botJid = normaliseJid(sock.user.id);
        const senderNormalised = normaliseJid(senderId);

        const isBotAdmin = participants.some(p => normaliseJid(p.id) === botJid && (p.admin === 'admin' || p.admin === 'superadmin'));
        const isSenderAdmin = participants.some(p => normaliseJid(p.id) === senderNormalised && (p.admin === 'admin' || p.admin === 'superadmin'));

        if (!isBotAdmin) {
            await sock.sendMessage(chatId, { text: '🚫 I need to be an admin to kick members.' }, { quoted: createFakeContact(message) });
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return;
        }

        if (!isSenderAdmin) {
            await sock.sendMessage(chatId, { text: '🚫 Only group admins can use the .kickall command.' }, { quoted: createFakeContact(message) });
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return;
        }

        const targets = participants
            .filter(p => {
                const normId = normaliseJid(p.id);
                return normId !== botJid &&
                       normId !== senderNormalised &&
                       p.admin !== 'admin' && 
                       p.admin !== 'superadmin';
            })
            .map(p => p.id);

        if (targets.length === 0) {
            await sock.sendMessage(chatId, { text: '⚠️ No non-admin members to kick.' }, { quoted: createFakeContact(message) });
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return;
        }

        await sock.sendMessage(chatId, { text: `🔄 Kicking ${targets.length} member(s)...` }, { quoted: createFakeContact(message) });

        for (let i = 0; i < targets.length; i += 5) {
            const batch = targets.slice(i, i + 5);
            try {
                await sock.groupParticipantsUpdate(chatId, batch, 'remove');
            } catch (batchErr) {
                console.error('Batch kick failed:', batchErr);
            }
        }

        await sock.sendMessage(chatId, { text: `✅ Successfully kicked ${targets.length} member(s).` }, { quoted: createFakeContact(message) });
        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
    } catch (err) {
        console.error('Error in kickAllCommand:', err);
        await sock.sendMessage(chatId, { text: '❌ An unexpected error occurred.' }, { quoted: createFakeContact(message) });
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
    }
}

module.exports = kickAllCommand;
