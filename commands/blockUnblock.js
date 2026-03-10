const { isSudo } = require('../lib/index');
const { normalizeJid, resolvePhoneFromLid, isLid } = require('../lib/jid');

const delay = ms => new Promise(r => setTimeout(r, ms));

function jidToPhone(jid) {
    if (!jid) return '';
    return jid.split(':')[0].split('@')[0];
}

async function isOwnerOrSudo(sock, message) {
    if (message?.key?.fromMe === true) return true;
    const senderId = message?.key?.participant || message?.key?.remoteJid;
    if (!senderId) return false;
    return await isSudo(normalizeJid(senderId));
}

function getTargetFromMessage(message) {
    const ctx = message.message?.extendedTextMessage?.contextInfo;
    if (ctx?.participant) return normalizeJid(ctx.participant);
    if (ctx?.mentionedJid?.length) return normalizeJid(ctx.mentionedJid[0]);
    return null;
}

function getTargetFromArgs(message) {
    const text =
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text || '';
    const arg = text.trim().split(/\s+/).slice(1).join('').replace(/\D/g, '');
    if (arg.length < 6) return null;
    return normalizeJid(`${arg}@s.whatsapp.net`);
}

function getBotJid(sock) {
    const raw = sock.user?.id || '';
    const num = raw.split(':')[0];
    return `${num}@s.whatsapp.net`;
}

/**
 * Resolve a @lid JID to a @s.whatsapp.net JID so it can be used with updateBlockStatus.
 * Strategy:
 *  1. Session file lookup (lid-mapping files)
 *  2. Group metadata participants cross-reference
 *  3. sock.contacts lookup
 *  Returns null if it cannot be resolved.
 */
async function resolveLidToPhoneJid(sock, lidJid, chatId) {
    if (!isLid(lidJid)) return lidJid;

    const lidNum = lidJid.split('@')[0];

    // 1. Try session file lookup
    const fromSession = resolvePhoneFromLid(lidNum);
    if (fromSession) return `${fromSession}@s.whatsapp.net`;

    // 2. Try group metadata participants lookup
    if (chatId && chatId.endsWith('@g.us')) {
        try {
            const meta = await sock.groupMetadata(chatId);
            if (meta && Array.isArray(meta.participants)) {
                for (const p of meta.participants) {
                    if (!p.id) continue;
                    if (p.id === lidJid || p.lid === lidJid) {
                        // Some Baileys versions expose both p.id and p.lid
                        const phoneJid = p.id.endsWith('@s.whatsapp.net') ? p.id
                                       : (p.lid && p.lid === lidJid && p.id) ? p.id
                                       : null;
                        if (phoneJid) return normalizeJid(phoneJid);
                    }
                    // Cross-match: participant id is @lid, check if there's phone info
                    if (p.lid && p.lid === lidJid && p.id && p.id.endsWith('@s.whatsapp.net')) {
                        return normalizeJid(p.id);
                    }
                }
            }
        } catch (_) {}
    }

    // 3. Try sock.contacts lookup
    try {
        const contacts = sock.contacts || {};
        if (contacts[lidJid]?.lid) {
            const phone = contacts[lidJid].lid.split('@')[0];
            if (phone) return `${phone}@s.whatsapp.net`;
        }
        // Sometimes contacts stores by phone JID with a lid field
        for (const [key, val] of Object.entries(contacts)) {
            if ((val?.lid === lidJid || val?.id === lidJid) && key.endsWith('@s.whatsapp.net')) {
                return normalizeJid(key);
            }
        }
    } catch (_) {}

    return null;
}

async function blockCommand(sock, chatId, message) {
    if (!(await isOwnerOrSudo(sock, message))) {
        return sock.sendMessage(chatId, {
            text: '❌ *Owner Only*\nThis command is reserved for the bot owner.'
        }, { quoted: message });
    }

    const rawTarget = getTargetFromMessage(message) || getTargetFromArgs(message);

    if (!rawTarget) {
        await sock.sendMessage(chatId, { react: { text: '❓', key: message.key } });
        return sock.sendMessage(chatId, {
            text: '*🔒 Block a User*\n\n' +
                  'You must specify who to block:\n\n' +
                  '▸ Reply to their message and send `.block`\n' +
                  '▸ Mention them: `.block @user`\n' +
                  '▸ Use their number: `.block 2348012345678`'
        }, { quoted: message });
    }

    const botJid = getBotJid(sock);

    // Resolve @lid to @s.whatsapp.net if needed
    let target = rawTarget;
    if (isLid(rawTarget)) {
        const resolved = await resolveLidToPhoneJid(sock, rawTarget, chatId);
        if (!resolved) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return sock.sendMessage(chatId, {
                text: '❌ *Cannot Block*\n\n' +
                      'This user has a new WhatsApp ID format that could not be resolved.\n\n' +
                      '▸ Try using their phone number directly:\n' +
                      '  `.block 2348012345678`'
            }, { quoted: message });
        }
        target = resolved;
    }

    if (normalizeJid(target) === normalizeJid(botJid)) {
        return sock.sendMessage(chatId, {
            text: '❌ You cannot block the bot itself.'
        }, { quoted: message });
    }

    const phone = jidToPhone(target);

    try {
        await sock.updateBlockStatus(target, 'block');
        await sock.sendMessage(chatId, { react: { text: '🔒', key: message.key } });
        await sock.sendMessage(chatId, {
            text: `🔒 *User Blocked*\n\n` +
                  `📱 Number : +${phone}\n` +
                  `📌 Status  : Blocked\n\n` +
                  `_This user can no longer message the bot._`
        }, { quoted: message });
    } catch (e) {
        console.error('[Block] Error:', e);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, {
            text: `❌ *Block Failed*\n\nCould not block +${phone}.\n_Reason: ${e.message}_`
        }, { quoted: message });
    }
}

async function unblockCommand(sock, chatId, message) {
    if (!(await isOwnerOrSudo(sock, message))) {
        return sock.sendMessage(chatId, {
            text: '❌ *Owner Only*\nThis command is reserved for the bot owner.'
        }, { quoted: message });
    }

    const rawTarget = getTargetFromMessage(message) || getTargetFromArgs(message);

    if (!rawTarget) {
        await sock.sendMessage(chatId, { react: { text: '❓', key: message.key } });
        return sock.sendMessage(chatId, {
            text: '*🔓 Unblock a User*\n\n' +
                  'You must specify who to unblock:\n\n' +
                  '▸ Reply to their message and send `.unblock`\n' +
                  '▸ Mention them: `.unblock @user`\n' +
                  '▸ Use their number: `.unblock 2348012345678`'
        }, { quoted: message });
    }

    // Resolve @lid to @s.whatsapp.net if needed
    let target = rawTarget;
    if (isLid(rawTarget)) {
        const resolved = await resolveLidToPhoneJid(sock, rawTarget, chatId);
        if (!resolved) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return sock.sendMessage(chatId, {
                text: '❌ *Cannot Unblock*\n\n' +
                      'This user has a new WhatsApp ID format that could not be resolved.\n\n' +
                      '▸ Try using their phone number directly:\n' +
                      '  `.unblock 2348012345678`'
            }, { quoted: message });
        }
        target = resolved;
    }

    const phone = jidToPhone(target);

    try {
        const blocklist = await sock.fetchBlocklist().catch(() => []);
        const isBlocked = blocklist.some(j => normalizeJid(j) === normalizeJid(target));

        if (!isBlocked) {
            await sock.sendMessage(chatId, { react: { text: '⚠️', key: message.key } });
            return sock.sendMessage(chatId, {
                text: `⚠️ *Not Blocked*\n\n+${phone} is not in the blocklist.`
            }, { quoted: message });
        }

        await sock.updateBlockStatus(target, 'unblock');
        await sock.sendMessage(chatId, { react: { text: '🔓', key: message.key } });
        await sock.sendMessage(chatId, {
            text: `🔓 *User Unblocked*\n\n` +
                  `📱 Number : +${phone}\n` +
                  `📌 Status  : Unblocked\n\n` +
                  `_This user can now message the bot again._`
        }, { quoted: message });
    } catch (e) {
        console.error('[Unblock] Error:', e);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, {
            text: `❌ *Unblock Failed*\n\nCould not unblock +${phone}.\n_Reason: ${e.message}_`
        }, { quoted: message });
    }
}

async function unblockallCommand(sock, chatId, message) {
    if (!(await isOwnerOrSudo(sock, message))) {
        return sock.sendMessage(chatId, {
            text: '❌ *Owner Only*\nThis command is restricted to the bot owner.'
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
            text: '❌ *Owner Only*\nThis command is restricted to the bot owner.'
        }, { quoted: message });
    }

    await sock.sendMessage(chatId, { react: { text: '📋', key: message.key } });

    const blocked = await sock.fetchBlocklist().catch(() => []);
    if (!blocked.length) {
        return sock.sendMessage(chatId, {
            text: '📭 *Blocklist Empty*\n\nNo contacts are currently blocked.'
        }, { quoted: message });
    }

    const lines = blocked.map((jid, i) => {
        const phone = jidToPhone(jid);
        return `${String(i + 1).padStart(2, '0')}. +${phone}`;
    });

    const chunks = [];
    const copy = [...lines];
    while (copy.length) chunks.push(copy.splice(0, 50));

    for (let i = 0; i < chunks.length; i++) {
        const header = i === 0 ? `🔒 *Blocked Contacts* (${blocked.length} total)\n\n` : '';
        await sock.sendMessage(chatId, { text: header + chunks[i].join('\n') }, { quoted: message });
        if (i < chunks.length - 1) await delay(500);
    }
}

module.exports = { blockCommand, unblockCommand, unblockallCommand, blocklistCommand };
