const { isSudo } = require('../lib/index');
const { normalizeJid } = require('../lib/jid');

const delay = ms => new Promise(r => setTimeout(r, ms));

/**
 * Convert any JID to a clean phone number string (without device suffix or domain).
 * @param {string} jid - The JID (e.g., "123456789:1@s.whatsapp.net")
 * @returns {string} - Clean phone number (e.g., "123456789")
 */
function jidToPhone(jid) {
    if (!jid) return '';
    // Remove device suffix (e.g., :1) and domain
    return jid.split(':')[0].replace('@s.whatsapp.net', '');
}

async function isOwnerOrSudo(sock, message) {
    if (message?.key?.fromMe === true) return true;
    const senderId = message?.key?.participant || message?.key?.remoteJid;
    if (!senderId) return false;
    return await isSudo(normalizeJid(senderId));
}

function getTargetJid(message) {
    const ctx = message.message?.extendedTextMessage?.contextInfo;
    if (ctx?.participant) return normalizeJid(ctx.participant);
    if (ctx?.mentionedJid?.length) return normalizeJid(ctx.mentionedJid[0]);
    return null;
}

function parseNumberArg(message) {
    const text = message.message?.conversation ||
                 message.message?.extendedTextMessage?.text || '';
    const arg = text.trim().split(/\s+/)[1];
    if (!arg) return null;
    const digits = arg.replace(/\D/g, '');
    if (digits.length < 7) return null;
    // Normalize the constructed JID to strip any accidental device suffix
    return normalizeJid(`${digits}@s.whatsapp.net`);
}

async function blockCommand(sock, chatId, message) {
    if (!(await isOwnerOrSudo(sock, message))) {
        return sock.sendMessage(chatId, {
            text: '❌ *Owner Only*\n\nThis command is restricted to the bot owner.',
        }, { quoted: message });
    }

    await sock.sendMessage(chatId, { react: { text: '🔒', key: message.key } });

    const target = getTargetJid(message) || parseNumberArg(message);
    if (!target) {
        return sock.sendMessage(chatId, {
            text: '❌ *No target found*\n\nReply to a message, mention a user, or provide a number.\n\n*Usage:*\n▸ `.block` (reply)\n▸ `.block @user`\n▸ `.block 2348012345678`'
        }, { quoted: message });
    }

    const botId = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
    if (normalizeJid(target) === normalizeJid(botId)) {
        return sock.sendMessage(chatId, { text: '❌ Cannot block the bot itself.' }, { quoted: message });
    }

    try {
        await sock.updateBlockStatus(target, 'block');
        await sock.sendMessage(chatId, {
            text: `🔒 *Blocked*\n\n+${jidToPhone(target)} has been blocked.`
        }, { quoted: message });
    } catch (e) {
        console.error('[Block] Error:', e);
        await sock.sendMessage(chatId, { text: `❌ Failed to block: ${e.message}` }, { quoted: message });
    }
}

async function unblockCommand(sock, chatId, message) {
    if (!(await isOwnerOrSudo(sock, message))) {
        return sock.sendMessage(chatId, {
            text: '❌ *Owner Only*\n\nThis command is restricted to the bot owner.'
        }, { quoted: message });
    }

    await sock.sendMessage(chatId, { react: { text: '🔓', key: message.key } });

    const target = getTargetJid(message) || parseNumberArg(message);
    if (!target) {
        return sock.sendMessage(chatId, {
            text: '❌ *No target found*\n\nReply to a message, mention a user, or provide a number.\n\n*Usage:*\n▸ `.unblock` (reply)\n▸ `.unblock @user`\n▸ `.unblock 2348012345678`'
        }, { quoted: message });
    }

    try {
        await sock.updateBlockStatus(target, 'unblock');
        await sock.sendMessage(chatId, {
            text: `🔓 *Unblocked*\n\n+${jidToPhone(target)} has been unblocked.`
        }, { quoted: message });
    } catch (e) {
        console.error('[Unblock] Error:', e);
        await sock.sendMessage(chatId, { text: `❌ Failed to unblock: ${e.message}` }, { quoted: message });
    }
}

async function unblockallCommand(sock, chatId, message) {
    if (!(await isOwnerOrSudo(sock, message))) {
        return sock.sendMessage(chatId, {
            text: '❌ *Owner Only*\n\nThis command is restricted to the bot owner.'
        }, { quoted: message });
    }

    await sock.sendMessage(chatId, { react: { text: '🔓', key: message.key } });

    const blocked = await sock.fetchBlocklist().catch(() => []);
    if (!blocked.length) {
        return sock.sendMessage(chatId, { text: '📭 No blocked contacts to unblock.' }, { quoted: message });
    }

    await sock.sendMessage(chatId, { text: `⏳ Unblocking ${blocked.length} contact(s)...` }, { quoted: message });

    let success = 0;
    for (const jid of blocked) {
        try {
            await sock.updateBlockStatus(jid, 'unblock');
            success++;
            await delay(400);
        } catch (e) {
            console.error('[Unblockall] Failed:', jid, e.message);
        }
    }

    await sock.sendMessage(chatId, {
        text: `🔓 *Unblock All Complete*\n\nSuccessfully unblocked: ${success}/${blocked.length} contacts.`
    }, { quoted: message });
}

async function blocklistCommand(sock, chatId, message) {
    if (!(await isOwnerOrSudo(sock, message))) {
        return sock.sendMessage(chatId, {
            text: '❌ *Owner Only*\n\nThis command is restricted to the bot owner.'
        }, { quoted: message });
    }

    await sock.sendMessage(chatId, { react: { text: '📋', key: message.key } });

    const blocked = await sock.fetchBlocklist().catch(() => []);
    if (!blocked.length) {
        return sock.sendMessage(chatId, {
            text: '📭 *Blocklist Empty*\n\nNo contacts are currently blocked.'
        }, { quoted: message });
    }

    // Format each JID to a clean phone number and pad with leading zeros for alignment
    const lines = blocked.map((jid, i) => {
        const phone = jidToPhone(jid);
        return `${String(i + 1).padStart(2, '0')}. +${phone}`;
    });

    const chunks = [];
    while (lines.length) chunks.push(lines.splice(0, 50));

    for (let i = 0; i < chunks.length; i++) {
        const header = i === 0 ? `🔒 *Blocked Contacts* (${blocked.length} total)\n\n` : '';
        await sock.sendMessage(chatId, { text: header + chunks[i].join('\n') }, { quoted: message });
        if (i < chunks.length - 1) await delay(500);
    }
}

module.exports = { blockCommand, unblockCommand, unblockallCommand, blocklistCommand };
