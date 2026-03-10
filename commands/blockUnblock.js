const { isSudo } = require('../lib/index');
const { normalizeJid } = require('../lib/jid');

const delay = ms => new Promise(r => setTimeout(r, ms));

/**
 * Convert JID to clean phone number string.
 * @param {string} jid
 * @returns {string}
 */
function jidToPhone(jid) {
    if (!jid) return '';
    return jid.split(':')[0].replace('@s.whatsapp.net', '');
}

/**
 * Check if sender is owner or sudo.
 */
async function isOwnerOrSudo(sock, message) {
    if (message?.key?.fromMe) return true;
    const senderId = message?.key?.participant || message?.key?.remoteJid;
    return senderId ? await isSudo(normalizeJid(senderId)) : false;
}

/**
 * Extract target JID from reply, mention, or argument.
 */
function getTargetJid(message) {
    const ctx = message.message?.extendedTextMessage?.contextInfo;
    if (ctx?.participant) return normalizeJid(ctx.participant);
    if (ctx?.mentionedJid?.length) return normalizeJid(ctx.mentionedJid[0]);
    return null;
}

/**
 * Parse number argument from text.
 */
function parseNumberArg(message) {
    const text = message.message?.conversation ||
                 message.message?.extendedTextMessage?.text || '';
    const arg = text.trim().split(/\s+/)[1];
    if (!arg) return null;
    const digits = arg.replace(/\D/g, '');
    return digits.length >= 7 ? normalizeJid(`${digits}@s.whatsapp.net`) : null;
}

/**
 * Generic block/unblock handler.
 */
async function handleBlockAction(sock, chatId, message, action) {
    const isBlock = action === 'block';
    const icon = isBlock ? '🔒' : '🔓';
    const verb = isBlock ? 'Blocked' : 'Unblocked';

    if (!(await isOwnerOrSudo(sock, message))) {
        return sock.sendMessage(chatId, {
            text: '❌ *Owner Only*\n\nThis command is restricted to the bot owner.'
        }, { quoted: message });
    }

    await sock.sendMessage(chatId, { react: { text: icon, key: message.key } });

    const target = getTargetJid(message) || parseNumberArg(message);
    if (!target) {
        return sock.sendMessage(chatId, {
            text: `❌ *No target found*\n\nReply, mention, or provide a number.\n\n*Usage:*\n▸ \`.${action}\` (reply)\n▸ \`.${action} @user`\n▸ \`.${action} 2348012345678\``
        }, { quoted: message });
    }

    const botId = normalizeJid(sock.user?.id?.split(':')[0] + '@s.whatsapp.net');
    if (normalizeJid(target) === botId && isBlock) {
        return sock.sendMessage(chatId, { text: '❌ Cannot block the bot itself.' }, { quoted: message });
    }

    try {
        await sock.updateBlockStatus(target, action);
        await sock.sendMessage(chatId, {
            text: `${icon} *${verb}*\n\n+${jidToPhone(target)} has been ${verb.toLowerCase()}.`
        }, { quoted: message });
    } catch (e) {
        console.error(`[${verb}] Error:`, e);
        await sock.sendMessage(chatId, { text: `❌ Failed to ${action}: ${e.message}` }, { quoted: message });
    }
}

/**
 * Unblock all contacts.
 */
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

/**
 * Show blocklist.
 */
async function blocklistCommand(sock, chatId, message) {
    if (!(await isOwnerOrSudo(sock, message))) {
        return sock.sendMessage(chatId, {
            text: '❌ *Owner Only*\n\nThis command is restricted to the bot owner.'
        }, { quoted: message });
    }

    await sock.sendMessage(chatId, { react: { text: '📋', key: message.key } });

    const blocked = await sock.fetchBlocklist().catch(() => []);
    if (!blocked.length) {
        return sock.sendMessage(chatId, { text: '📭 *Blocklist Empty*\n\nNo contacts are currently blocked.' }, { quoted: message });
    }

    const lines = blocked.map((jid, i) => `${String(i + 1).padStart(2, '0')}. +${jidToPhone(jid)}`);
    const chunks = [];
    while (lines.length) chunks.push(lines.splice(0, 50));

    for (let i = 0; i < chunks.length; i++) {
        const header = i === 0 ? `🔒 *Blocked Contacts* (${blocked.length} total)\n\n` : '';
        await sock.sendMessage(chatId, { text: header + chunks[i].join('\n') }, { quoted: message });
        if (i < chunks.length - 1) await delay(500);
    }
}

module.exports = {
    blockCommand: (sock, chatId, message) => handleBlockAction(sock, chatId, message, 'block'),
    unblockCommand: (sock, chatId, message) => handleBlockAction(sock, chatId, message, 'unblock'),
    unblockallCommand,
    blocklistCommand
};
