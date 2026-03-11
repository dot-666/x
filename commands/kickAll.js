const { createFakeContact } = require('../lib/fakeContact');

function normaliseJid(jid) {
    if (!jid) return jid;
    let [user] = jid.split('@');
    if (user.includes(':')) user = user.split(':')[0];
    return `${user}@s.whatsapp.net`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function kickAllCommand(sock, chatId, message, senderId) {
    const fake = createFakeContact(message);

    try {
        if (!chatId.endsWith('@g.us')) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return await sock.sendMessage(chatId, {
                text: '🚫 This command only works in groups.'
            }, { quoted: fake });
        }

        const metadata = await sock.groupMetadata(chatId);
        const participants = metadata.participants || [];

        const botJid = normaliseJid(sock.user.id);
        const senderNorm = normaliseJid(senderId);

        const isBotAdmin = participants.some(p =>
            normaliseJid(p.id) === botJid &&
            (p.admin === 'admin' || p.admin === 'superadmin')
        );

        const isSenderAdmin = participants.some(p =>
            normaliseJid(p.id) === senderNorm &&
            (p.admin === 'admin' || p.admin === 'superadmin')
        );

        if (!isBotAdmin) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return await sock.sendMessage(chatId, {
                text: '🚫 I need to be a group admin to kick members.'
            }, { quoted: fake });
        }

        if (!isSenderAdmin) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return await sock.sendMessage(chatId, {
                text: '🚫 Only group admins can use .kickall.'
            }, { quoted: fake });
        }

        const targets = participants
            .filter(p => {
                const norm = normaliseJid(p.id);
                return (
                    norm !== botJid &&
                    norm !== senderNorm &&
                    p.admin !== 'admin' &&
                    p.admin !== 'superadmin'
                );
            })
            .map(p => p.id);

        if (targets.length === 0) {
            await sock.sendMessage(chatId, { react: { text: '⚠️', key: message.key } });
            return await sock.sendMessage(chatId, {
                text: '⚠️ No non-admin members to kick.'
            }, { quoted: fake });
        }

        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });
        await sock.sendMessage(chatId, {
            text: `⏳ Kicking *${targets.length}* member(s), please wait...`
        }, { quoted: fake });

        let kicked = 0;
        let failed = 0;

        for (const jid of targets) {
            try {
                await sock.groupParticipantsUpdate(chatId, [jid], 'remove');
                kicked++;
            } catch {
                failed++;
            }
            await sleep(700);
        }

        const summary = failed > 0
            ? `✅ Kicked *${kicked}/${targets.length}* member(s).\n⚠️ ${failed} could not be removed (may have already left or are protected).`
            : `✅ Successfully kicked all *${kicked}* member(s).`;

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
        return await sock.sendMessage(chatId, { text: summary }, { quoted: fake });

    } catch (err) {
        console.error('kickAllCommand error:', err);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        return await sock.sendMessage(chatId, {
            text: `❌ Error: ${err.message || 'Unknown error'}`
        }, { quoted: fake });
    }
}

module.exports = kickAllCommand;
