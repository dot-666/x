const fs = require('fs');
const path = require('path');
const isAdmin = require('../lib/isAdmin');
const { createFakeContact } = require('../lib/fakeContact');

// In-memory storage
const antiStatusMentionData = { settings: {}, warns: {} };

// Database file path
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'antistatusmention.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadData() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const data = fs.readFileSync(DB_PATH, 'utf8');
            Object.assign(antiStatusMentionData, JSON.parse(data));
        }
    } catch (error) {
        console.error('[AntiStatusMention] Load error:', error);
    }
}

function saveData() {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(antiStatusMentionData, null, 2));
    } catch (error) {
        console.error('[AntiStatusMention] Save error:', error);
    }
}

loadData();

async function getSettings(chatId) {
    return antiStatusMentionData.settings[chatId] || {
        status: 'off',
        warn_limit: 3,
        action: 'off'
    };
}

async function updateSettings(chatId, updates) {
    if (!antiStatusMentionData.settings[chatId]) {
        antiStatusMentionData.settings[chatId] = { status: 'off', warn_limit: 3, action: 'off' };
    }
    Object.assign(antiStatusMentionData.settings[chatId], updates);
    saveData();
    return antiStatusMentionData.settings[chatId];
}

async function clearWarns(chatId) {
    delete antiStatusMentionData.warns[chatId];
    saveData();
}

async function getWarns(chatId, userId) {
    return (antiStatusMentionData.warns[chatId] || {})[userId] || 0;
}

async function addWarn(chatId, userId) {
    if (!antiStatusMentionData.warns[chatId]) antiStatusMentionData.warns[chatId] = {};
    antiStatusMentionData.warns[chatId][userId] = (antiStatusMentionData.warns[chatId][userId] || 0) + 1;
    saveData();
    return antiStatusMentionData.warns[chatId][userId];
}

async function resetWarn(chatId, userId) {
    if (antiStatusMentionData.warns[chatId]) {
        delete antiStatusMentionData.warns[chatId][userId];
        saveData();
    }
}

// Command handler
async function antistatusmentionCommand(sock, chatId, message) {
    try {
        if (!chatId.endsWith('@g.us')) {
            await sock.sendMessage(chatId, {
                text: '❌ This command can only be used in groups!'
            }, { quoted: createFakeContact(message) });
            return;
        }

        await sock.sendMessage(chatId, { react: { text: '🛡️', key: message.key } });

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const parts = text.trim().split(/\s+/);
        const query = parts.slice(1).join(' ').trim();

        const groupMetadata = await sock.groupMetadata(chatId).catch(() => null);
        if (!groupMetadata) {
            return await sock.sendMessage(chatId, {
                text: '❌ Failed to fetch group metadata!'
            }, { quoted: createFakeContact(message) });
        }

        const userId = message.key.participant || message.key.remoteJid;

        // Proper admin check
        const { isSenderAdmin } = await isAdmin(sock, chatId, userId);
        if (!isSenderAdmin && !message.key.fromMe) {
            await sock.sendMessage(chatId, {
                text: '❌ This command is only for group admins!',
                mentions: [userId]
            }, { quoted: createFakeContact(message) });
            return;
        }

        const { isBotAdmin } = await isAdmin(sock, chatId, sock.user?.id?.split(':')[0] + '@s.whatsapp.net');
        if (!isBotAdmin) {
            await sock.sendMessage(chatId, {
                text: '❌ Please make the bot an admin first!',
                mentions: [userId]
            }, { quoted: createFakeContact(message) });
            return;
        }

        const settings = await getSettings(chatId);
        const statusMap = { off: '❌ OFF', warn: '⚠️ WARN', delete: '🗑️ DELETE', remove: '🚫 REMOVE' };

        if (!query) {
            const totalWarned = Object.keys(antiStatusMentionData.warns[chatId] || {}).length;
            return await sock.sendMessage(chatId, {
                text: `*🛡️ Anti-Status-Mention Settings*\n\n` +
                      `┌ Status: ${statusMap[settings.action] || '❌ OFF'}\n` +
                      `│ Warn limit: ${settings.warn_limit}\n` +
                      `│ Warned users: ${totalWarned}\n` +
                      `└──────────────\n\n` +
                      `*Commands:*\n` +
                      `• \`antistatusmention off\` — Disable\n` +
                      `• \`antistatusmention warn\` — Warn users\n` +
                      `• \`antistatusmention delete\` — Delete messages only\n` +
                      `• \`antistatusmention remove\` — Remove users\n` +
                      `• \`antistatusmention limit 1-10\` — Set warn limit\n` +
                      `• \`antistatusmention resetwarns\` — Clear all warns`,
                mentions: [userId]
            }, { quoted: createFakeContact(message) });
        }

        const args = query.split(/\s+/);
        const sub = args[0]?.toLowerCase();

        switch (sub) {
            case 'off':
            case 'warn':
            case 'delete':
            case 'remove':
                await updateSettings(chatId, { status: sub, action: sub });
                await sock.sendMessage(chatId, {
                    text: `✅ Anti-status-mention set to *${sub.toUpperCase()}*\nGroup: ${groupMetadata.subject}`,
                    mentions: [userId]
                }, { quoted: createFakeContact(message) });
                break;

            case 'limit': {
                const limit = parseInt(args[1]);
                if (isNaN(limit) || limit < 1 || limit > 10) {
                    await sock.sendMessage(chatId, {
                        text: '❌ Limit must be a number between 1 and 10.',
                        mentions: [userId]
                    }, { quoted: createFakeContact(message) });
                    return;
                }
                await updateSettings(chatId, { warn_limit: limit });
                await sock.sendMessage(chatId, {
                    text: `✅ Warn limit set to *${limit}*`,
                    mentions: [userId]
                }, { quoted: createFakeContact(message) });
                break;
            }

            case 'resetwarns':
                await clearWarns(chatId);
                await sock.sendMessage(chatId, {
                    text: `✅ All status mention warns cleared for ${groupMetadata.subject}`,
                    mentions: [userId]
                }, { quoted: createFakeContact(message) });
                break;

            case 'status':
            case 'info': {
                const totalWarned = Object.keys(antiStatusMentionData.warns[chatId] || {}).length;
                await sock.sendMessage(chatId, {
                    text: `*📊 Anti-Status-Mention*\n\n` +
                          `┌ Group: ${groupMetadata.subject}\n` +
                          `│ Status: ${statusMap[settings.action] || '❌ OFF'}\n` +
                          `│ Warn limit: ${settings.warn_limit}\n` +
                          `│ Warned users: ${totalWarned}\n` +
                          `└──────────────`,
                    mentions: [userId]
                }, { quoted: createFakeContact(message) });
                break;
            }

            default:
                await sock.sendMessage(chatId, {
                    text: '❌ Unknown subcommand. Use: off / warn / delete / remove / limit / resetwarns / status',
                    mentions: [userId]
                }, { quoted: createFakeContact(message) });
        }
    } catch (error) {
        console.error('[AntiStatusMention] Command error:', error);
        await sock.sendMessage(chatId, {
            text: `🚫 Error: ${error.message}`
        }, { quoted: createFakeContact(message) });
    }
}

// Detect if a message has a status@broadcast mention or is quoting a status
function hasStatusMention(message) {
    const types = [
        'extendedTextMessage',
        'imageMessage',
        'videoMessage',
        'audioMessage',
        'documentMessage',
        'stickerMessage'
    ];

    for (const type of types) {
        const ctx = message.message?.[type]?.contextInfo;
        if (!ctx) continue;

        // Mentioned JID list includes status@broadcast
        if (Array.isArray(ctx.mentionedJid) && ctx.mentionedJid.includes('status@broadcast')) return true;

        // Message is a reply to a status
        if (ctx.remoteJid === 'status@broadcast') return true;
        if (ctx.participant?.endsWith('@s.whatsapp.net') && ctx.remoteJid === 'status@broadcast') return true;
    }

    return false;
}

// Event handler
async function handleAntiStatusMention(sock, message) {
    try {
        const chatId = message.key.remoteJid;
        if (!chatId?.endsWith('@g.us')) return;

        const settings = await getSettings(chatId);
        if (!settings || settings.action === 'off') return;

        if (!hasStatusMention(message)) return;

        const userId = message.key.participant || message.key.remoteJid;

        // Skip admins - properly destructure the result
        const { isSenderAdmin } = await isAdmin(sock, chatId, userId);
        if (isSenderAdmin) return;

        const groupMetadata = await sock.groupMetadata(chatId).catch(() => null);
        const groupName = groupMetadata?.subject || 'the group';

        // Delete message (no quoted needed for delete)
        try {
            await sock.sendMessage(chatId, { delete: message.key });
        } catch (e) {
            console.error('[AntiStatusMention] Delete failed:', e.message);
        }

        switch (settings.action) {
            case 'delete':
                await sock.sendMessage(chatId, {
                    text: `🗑️ @${userId.split('@')[0]}'s message was deleted — status mentions are not allowed here.\n\n*Group:* ${groupName}`,
                    mentions: [userId]
                });
                break;

            case 'warn': {
                const warnCount = await addWarn(chatId, userId);
                if (warnCount >= settings.warn_limit) {
                    await resetWarn(chatId, userId);
                    await sock.sendMessage(chatId, {
                        text: `⚠️ *Final Warning* @${userId.split('@')[0]}\n\n` +
                              `Warns: ${warnCount}/${settings.warn_limit} — Next violation may result in removal!\n*Group:* ${groupName}`,
                        mentions: [userId]
                    });
                } else {
                    await sock.sendMessage(chatId, {
                        text: `⚠️ *Warning* @${userId.split('@')[0]}\n\n` +
                              `Don't mention @status in this group!\nWarns: ${warnCount}/${settings.warn_limit}\n*Group:* ${groupName}`,
                        mentions: [userId]
                    });
                }
                break;
            }

            case 'remove':
                try {
                    await sock.groupParticipantsUpdate(chatId, [userId], 'remove');
                    await sock.sendMessage(chatId, {
                        text: `🚫 @${userId.split('@')[0]} was removed for mentioning @status.\n*Group:* ${groupName}`,
                        mentions: [userId]
                    });
                } catch (e) {
                    console.error('[AntiStatusMention] Remove failed:', e.message);
                }
                break;
        }
    } catch (error) {
        console.error('[AntiStatusMention] Handler error:', error);
    }
}

module.exports = { antistatusmentionCommand, handleAntiStatusMention };
