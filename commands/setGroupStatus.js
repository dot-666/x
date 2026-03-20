const { downloadContentFromMessage, generateWAMessageContent, generateWAMessageFromContent } = require('@whiskeysockets/baileys');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const { PassThrough } = require('stream');
const { createFakeContact } = require('../lib/fakeContact');

// ================================================
// Sticker conversion helper
// ================================================
async function convertStickerToImage(stickerBuffer) {
    // For animated WebP stickers just return the buffer as-is (WhatsApp handles it)
    return stickerBuffer;
}

// ================================================
// Main command
// ================================================
async function setGroupStatusCommand(sock, chatId, msg) {
    try {
        // Group check
        const isGroup = chatId.endsWith('@g.us');
        if (!isGroup) {
            return sock.sendMessage(chatId, { text: '❌ Groups only!' }, { quoted: msg });
        }

        // Admin check
        const participant = await sock.groupMetadata(chatId).then(metadata =>
            metadata.participants.find(p => p.id === msg.key.participant || p.id === msg.key.remoteJid)
        );
        const isAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
        const { isSudo: isSudoCheck } = require('../lib/index');
        const senderJid = msg.key.participant || msg.key.remoteJid;
        if (!isAdmin && !msg.key.fromMe && !(await isSudoCheck(senderJid))) {
            return sock.sendMessage(chatId, { text: '❌ Admins only!' }, { quoted: msg });
        }

        const messageText =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption || '';

        const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        // Regex that matches ALL aliases including togroupstatus
        const commandRegex = /^[.!#/]?(togroupstatus|setgstatus|togstatus|swgc|groupstatus|tosgroup)\s*/i;

        // Extract text typed after the command
        let textAfterCommand = '';
        const match = messageText.match(commandRegex);
        if (match) {
            textAfterCommand = messageText.slice(match[0].length).trim();
        }

        // If there's no quoted message AND no text after the command → show help
        if (!quotedMessage && !textAfterCommand) {
            return sock.sendMessage(chatId, { text: getHelpText() }, { quoted: msg });
        }

        let payload = null;

        if (quotedMessage) {
            payload = await buildPayloadFromQuoted(quotedMessage);
            // Attach caption typed after command to media payload
            if (textAfterCommand && payload && (payload.video || payload.image || payload.audio)) {
                if (!payload.audio) {
                    payload.caption = textAfterCommand;
                }
            }
        }

        // No quoted message — send plain text typed after command
        if (!payload) {
            if (textAfterCommand) {
                payload = { text: textAfterCommand };
            } else {
                return sock.sendMessage(chatId, { text: getHelpText() }, { quoted: msg });
            }
        }

        // Send group status
        await sendGroupStatus(sock, chatId, payload);

        const mediaType = detectMediaType(quotedMessage, payload);
        let successMsg = `✅ ${mediaType} sent to group status!`;
        if (payload.caption) successMsg += `\n📝 "${payload.caption}"`;
        if (payload.convertedSticker) successMsg += `\n(sticker → image)`;

        await sock.sendMessage(chatId, { text: successMsg }, { quoted: msg });

    } catch (error) {
        console.error('Error in group status command:', error);
        await sock.sendMessage(chatId, { text: `❌ Error: ${error.message}` }, { quoted: msg });
    }
}

/* ------------------ Helpers ------------------ */

function getHelpText() {
    return `✦ *GROUP STATUS* ✦

Commands: .togroupstatus | .setgstatus | .tosgroup

*Usage:*
✦ \`.togroupstatus hello group\` — send a text status
✦ Reply to an image with \`.togroupstatus\` — send image
✦ Reply to a video with \`.togroupstatus\` — send video
✦ Reply to an audio with \`.togroupstatus\` — send audio
✦ Reply to a sticker with \`.togroupstatus\` — send sticker as image
✦ Reply to media + \`.togroupstatus caption\` — add caption`;
}

async function buildPayloadFromQuoted(quotedMessage) {
    if (quotedMessage.videoMessage) {
        const buffer = await downloadToBuffer(quotedMessage.videoMessage, 'video');
        return {
            video: buffer,
            caption: quotedMessage.videoMessage.caption || '',
            gifPlayback: quotedMessage.videoMessage.gifPlayback || false,
            mimetype: quotedMessage.videoMessage.mimetype || 'video/mp4'
        };
    }
    if (quotedMessage.imageMessage) {
        const buffer = await downloadToBuffer(quotedMessage.imageMessage, 'image');
        return {
            image: buffer,
            caption: quotedMessage.imageMessage.caption || '',
            mimetype: quotedMessage.imageMessage.mimetype || 'image/jpeg'
        };
    }
    if (quotedMessage.audioMessage) {
        const buffer = await downloadToBuffer(quotedMessage.audioMessage, 'audio');
        if (quotedMessage.audioMessage.ptt) {
            const audioVn = await toVN(buffer);
            return { audio: audioVn, mimetype: 'audio/ogg; codecs=opus', ptt: true };
        }
        return { audio: buffer, mimetype: quotedMessage.audioMessage.mimetype || 'audio/mpeg', ptt: false };
    }
    if (quotedMessage.stickerMessage) {
        try {
            const buffer = await downloadToBuffer(quotedMessage.stickerMessage, 'sticker');
            const imageBuffer = await convertStickerToImage(buffer);
            return {
                image: imageBuffer,
                caption: '',
                mimetype: 'image/webp',
                convertedSticker: true
            };
        } catch (err) {
            console.error('Sticker conversion failed:', err);
            return { text: `⚠️ Sticker conversion failed: ${err.message}` };
        }
    }
    if (quotedMessage.conversation || quotedMessage.extendedTextMessage?.text) {
        const text = quotedMessage.conversation || quotedMessage.extendedTextMessage?.text || '';
        return { text };
    }
    return null;
}

function detectMediaType(quotedMessage, payload) {
    if (!quotedMessage) return 'Text';
    if (quotedMessage.videoMessage) return 'Video';
    if (quotedMessage.imageMessage) return 'Image';
    if (quotedMessage.audioMessage) return 'Audio';
    if (quotedMessage.stickerMessage) {
        return payload && payload.convertedSticker ? 'Sticker → Image' : 'Sticker';
    }
    return 'Text';
}

async function downloadToBuffer(message, type) {
    const stream = await downloadContentFromMessage(message, type);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    return buffer;
}

async function sendGroupStatus(conn, jid, content) {
    const inside = await generateWAMessageContent(content, { upload: conn.waUploadToServer });
    const messageSecret = crypto.randomBytes(32);
    const m = generateWAMessageFromContent(jid, {
        messageContextInfo: { messageSecret },
        groupStatusMessageV2: { message: { ...inside, messageContextInfo: { messageSecret } } }
    }, {});
    await conn.relayMessage(jid, m.message, { messageId: m.key.id });
    return m;
}

async function toVN(inputBuffer) {
    return new Promise((resolve, reject) => {
        const inStream = new PassThrough();
        inStream.end(inputBuffer);
        const outStream = new PassThrough();
        const chunks = [];
        ffmpeg(inStream)
            .noVideo()
            .audioCodec('libopus')
            .format('ogg')
            .audioBitrate('48k')
            .audioChannels(1)
            .audioFrequency(48000)
            .on('error', reject)
            .on('end', () => resolve(Buffer.concat(chunks)))
            .pipe(outStream, { end: true });
        outStream.on('data', chunk => chunks.push(chunk));
    });
}

module.exports = setGroupStatusCommand;
