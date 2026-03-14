const {
    downloadContentFromMessage,
    generateWAMessageContent,
    generateWAMessageFromContent
} = require('@whiskeysockets/baileys');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const { PassThrough } = require('stream');
const { createFakeContact } = require('../lib/fakeContact');

// Named colour map — first word after command can be a colour name
const COLOR_MAP = {
    green:   '#25D366',
    darkgreen: '#128C7E',
    teal:    '#128C7E',
    black:   '#000000',
    white:   '#FFFFFF',
    red:     '#E53935',
    blue:    '#1565C0',
    purple:  '#6A1B9A',
    orange:  '#E65100',
    pink:    '#E91E63',
    yellow:  '#F9A825',
    grey:    '#424242',
    gray:    '#424242',
};
const GREEN_BG = COLOR_MAP.green;

// Parse optional colour prefix: ".togroupstatus green hello" → { bg: '#25D366', text: 'hello' }
function parseColorAndText(raw) {
    const parts = raw.split(/\s+/);
    const maybeColor = parts[0]?.toLowerCase();
    if (maybeColor && COLOR_MAP[maybeColor]) {
        return { bg: COLOR_MAP[maybeColor], text: parts.slice(1).join(' ').trim() };
    }
    return { bg: GREEN_BG, text: raw };
}

// ================================================
// Main command
// ================================================
async function setGroupStatusCommand(sock, chatId, msg) {
    try {
        // Group check
        const isGroup = chatId.endsWith('@g.us');
        if (!isGroup) {
            return sock.sendMessage(chatId, { text: '❌ This command only works in groups!' }, { quoted: msg });
        }

        // Admin / sudo check
        const metadata = await sock.groupMetadata(chatId);
        const senderJid = msg.key.participant || msg.key.remoteJid;
        const participant = metadata.participants.find(p => p.id === senderJid);
        const isAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
        const { isSudo: isSudoCheck } = require('../lib/index');

        if (!isAdmin && !msg.key.fromMe && !(await isSudoCheck(senderJid))) {
            return sock.sendMessage(chatId, { text: '❌ Only group admins can use this command!' }, { quoted: msg });
        }

        const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        // Regex covers all valid command aliases including togroupstatus and setgstatus
        const commandRegex = /^[.!#/]?(togroupstatus|setgstatus|togstatus|swgc|groupstatus|tosgroup)\s*/i;
        const isCommandOnly = messageText.trim().match(commandRegex) &&
                              messageText.trim().replace(commandRegex, '').trim() === '';

        if (!quotedMessage && (!messageText.trim() || isCommandOnly)) {
            return sock.sendMessage(chatId, { text: getHelpText() }, { quoted: msg });
        }

        let payload = null;
        let textAfterCommand = '';

        if (messageText.trim()) {
            const match = messageText.match(commandRegex);
            if (match) textAfterCommand = messageText.slice(match[0].length).trim();
        }

        if (quotedMessage) {
            payload = await buildPayloadFromQuoted(quotedMessage);
            // Attach caption override if provided with the command
            if (textAfterCommand && payload) {
                if (payload.video || payload.image) {
                    payload.caption = textAfterCommand;
                } else if (payload.text !== undefined) {
                    // Override text too if replying to text
                    payload.text = textAfterCommand || payload.text;
                }
            }
        } else if (textAfterCommand) {
            // Allow optional colour name as first word: .togroupstatus green hello world
            const { bg, text } = parseColorAndText(textAfterCommand);
            if (!text) {
                return sock.sendMessage(chatId, { text: getHelpText() }, { quoted: msg });
            }
            payload = {
                text,
                backgroundColor: bg,
                font: 2
            };
        }

        if (!payload) {
            return sock.sendMessage(chatId, { text: getHelpText() }, { quoted: msg });
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
        // Use msg (not the undefined `message`) in the catch block
        await sock.sendMessage(chatId, { text: `❌ Error: ${error.message}` }, { quoted: msg });
    }
}

/* ------------------ Helpers ------------------ */

function getHelpText() {
    return `✦ *GROUP STATUS* ✦\n\n` +
           `Commands: .togroupstatus / .tosgroup / .setgstatus\n\n` +
           `*Text status:*\n` +
           `✦ .togroupstatus hello world — green bg (default)\n` +
           `✦ .togroupstatus red hello world — custom colour\n\n` +
           `*Colours:* green, darkgreen, teal, black, white,\n` +
           `red, blue, purple, orange, pink, yellow, grey\n\n` +
           `*Media status:*\n` +
           `✦ Reply to image/video/audio with .togroupstatus\n` +
           `✦ Add caption: .togroupstatus <caption> (when replying)`;
}

// Build message payload from a quoted message
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
            return {
                image: buffer,
                caption: '',
                mimetype: 'image/webp',
                convertedSticker: true
            };
        } catch (err) {
            console.error('Sticker download failed:', err);
            return { text: '⚠️ Could not download sticker.', backgroundColor: GREEN_BG, font: 2 };
        }
    }

    const textContent =
        quotedMessage.conversation ||
        quotedMessage.extendedTextMessage?.text || '';

    if (textContent) {
        return { text: textContent, backgroundColor: GREEN_BG, font: 2 };
    }

    return null;
}

function detectMediaType(quotedMessage, payload) {
    if (!quotedMessage) return 'Text';
    if (quotedMessage.videoMessage) return 'Video';
    if (quotedMessage.imageMessage) return 'Image';
    if (quotedMessage.audioMessage) return 'Audio';
    if (quotedMessage.stickerMessage) return payload?.convertedSticker ? 'Sticker (as image)' : 'Sticker';
    return 'Text';
}

// Download any media message type to a buffer
async function downloadToBuffer(msgObj, type) {
    const stream = await downloadContentFromMessage(msgObj, type);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

// Send a group channel status update (groupStatusMessageV2)
async function sendGroupStatus(conn, jid, content) {
    const inside = await generateWAMessageContent(content, { upload: conn.waUploadToServer });
    const messageSecret = crypto.randomBytes(32);
    const m = generateWAMessageFromContent(
        jid,
        {
            messageContextInfo: { messageSecret },
            groupStatusMessageV2: {
                message: { ...inside, messageContextInfo: { messageSecret } }
            }
        },
        {}
    );
    await conn.relayMessage(jid, m.message, { messageId: m.key.id });
    return m;
}

// Convert audio buffer to OGG voice note format
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
