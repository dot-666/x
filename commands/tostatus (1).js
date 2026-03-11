const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { createFakeContact } = require('../lib/fakeContact');
const store = require('../lib/lightweight_store');

const BG_COLORS = [
    '#000000', '#1a1a2e', '#16213e', '#0f3460',
    '#533483', '#e94560', '#ff6b6b', '#ffd93d',
    '#6bcb77', '#4d96ff', '#845ec2', '#ff9671'
];

function randomBg() {
    return BG_COLORS[Math.floor(Math.random() * BG_COLORS.length)];
}

function randomFont() {
    return Math.floor(Math.random() * 10);
}

function getStatusJidList(sock) {
    const contacts = store.contacts || {};
    const list = Object.keys(contacts).filter(jid => jid.endsWith('@s.whatsapp.net'));
    if (list.length === 0 && sock?.user?.id) {
        const selfJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        return [selfJid];
    }
    return list;
}

async function tostatusCommand(sock, chatId, message) {
    const fake = createFakeContact(message);

    try {
        await sock.sendMessage(chatId, { react: { text: '📤', key: message.key } });

        const rawText =
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text || '';
        const caption = rawText.trim().split(/\s+/).slice(1).join(' ').trim();

        const contextInfo = message.message?.extendedTextMessage?.contextInfo;
        const quoted = contextInfo?.quotedMessage;

        if (!caption && !quoted) {
            return await sock.sendMessage(chatId, {
                text: `*Usage:*\n` +
                      `◈ Reply to an image/video/audio with *.tostatus*\n` +
                      `◈ *.tostatus <text>* — post a text story\n` +
                      `◈ Reply + *.tostatus <caption>* — media with caption`
            }, { quoted: fake });
        }

        const statusJidList = getStatusJidList(sock);

        if (quoted) {
            const quotedMsg = {
                key: {
                    remoteJid: contextInfo.participant || chatId,
                    id: contextInfo.stanzaId,
                    fromMe: false,
                    participant: contextInfo.participant || undefined
                },
                message: quoted
            };

            const getBuffer = () =>
                downloadMediaMessage(
                    quotedMsg,
                    'buffer',
                    {},
                    { reuploadRequest: sock.updateMediaMessage }
                );

            if (quoted.imageMessage) {
                const buffer = await getBuffer();
                await sock.sendMessage(
                    'status@broadcast',
                    { image: buffer, caption },
                    { statusJidList }
                );
                await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
                return await sock.sendMessage(chatId, { text: '✅ Image posted to your story.' }, { quoted: fake });
            }

            if (quoted.videoMessage) {
                const buffer = await getBuffer();
                await sock.sendMessage(
                    'status@broadcast',
                    { video: buffer, caption, gifPlayback: false },
                    { statusJidList }
                );
                await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
                return await sock.sendMessage(chatId, { text: '✅ Video posted to your story.' }, { quoted: fake });
            }

            if (quoted.audioMessage) {
                const buffer = await getBuffer();
                await sock.sendMessage(
                    'status@broadcast',
                    { audio: buffer, mimetype: 'audio/mp4', ptt: false },
                    { statusJidList }
                );
                await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
                return await sock.sendMessage(chatId, { text: '✅ Audio posted to your story.' }, { quoted: fake });
            }

            const quotedText =
                quoted.conversation ||
                quoted.extendedTextMessage?.text || '';

            if (quotedText || caption) {
                const textToPost = caption || quotedText;
                await sock.sendMessage(
                    'status@broadcast',
                    { text: textToPost, backgroundColor: randomBg(), font: randomFont() },
                    { statusJidList }
                );
                await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
                return await sock.sendMessage(chatId, { text: '✅ Text story posted.' }, { quoted: fake });
            }

            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return await sock.sendMessage(chatId, {
                text: '⚠️ Unsupported media type. Reply to an image, video, or audio.'
            }, { quoted: fake });
        }

        await sock.sendMessage(
            'status@broadcast',
            { text: caption, backgroundColor: randomBg(), font: randomFont() },
            { statusJidList }
        );
        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
        return await sock.sendMessage(chatId, { text: '✅ Text story posted.' }, { quoted: fake });

    } catch (err) {
        console.error('tostatusCommand error:', err);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        return await sock.sendMessage(chatId, {
            text: `❌ Failed to post story: ${err.message || 'Unknown error'}`
        }, { quoted: fake });
    }
}

module.exports = tostatusCommand;
