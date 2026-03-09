const fs = require('fs');
const path = require('path');
const isAdmin = require('../lib/isAdmin');

const antiStatusMentionData = { settings: {}, warns: {} };

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'antistatusmention.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadData() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const data = fs.readFileSync(DB_PATH, 'utf8');
            Object.assign(antiStatusMentionData, JSON.parse(data));
        }
    } catch (error) {
        console.error('\x1b[35m[AntiStatusMention] Load error:\x1b[0m', error);
    }
}

function saveData() {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(antiStatusMentionData, null, 2));
    } catch (error) {
        console.error('\x1b[35m[AntiStatusMention] Save error:\x1b[0m', error);
    }
}

loadData();

async function getAntiStatusMentionSettings(chatId) {
    return antiStatusMentionData.settings[chatId] || {
        status: 'off',
        warn_limit: 3,
        action: 'warn'
    };
}

async function updateAntiStatusMentionSettings(chatId, updates) {
    if (!antiStatusMentionData.settings[chatId]) {
        antiStatusMentionData.settings[chatId] = {
            status: 'off',
            warn_limit: 3,
            action: 'warn'
        };
    }
    Object.assign(antiStatusMentionData.settings[chatId], updates);
    saveData();
    return antiStatusMentionData.settings[chatId];
}

async function clearAllStatusWarns(chatId) {
    if (antiStatusMentionData.warns[chatId]) {
        delete antiStatusMentionData.warns[chatId];
        saveData();
    }
    return true;
}

async function getUserStatusWarns(chatId, userId) {
    if (!antiStatusMentionData.warns[chatId]) {
        antiStatusMentionData.warns[chatId] = {};
    }
    return antiStatusMentionData.warns[chatId][userId] || 0;
}

async function addUserStatusWarn(chatId, userId) {
    if (!antiStatusMentionData.warns[chatId]) {
        antiStatusMentionData.warns[chatId] = {};
    }
    if (!antiStatusMentionData.warns[chatId][userId]) {
        antiStatusMentionData.warns[chatId][userId] = 0;
    }
    antiStatusMentionData.warns[chatId][userId]++;
    saveData();
    return antiStatusMentionData.warns[chatId][userId];
}

async function resetUserStatusWarns(chatId, userId) {
    if (antiStatusMentionData.warns[chatId] && antiStatusMentionData.warns[chatId][userId]) {
        delete antiStatusMentionData.warns[chatId][userId];
        saveData();
    }
    return true;
}

// Extract mentionedJid from any message type
function getMentionedJids(message) {
    const msg = message.message;
    if (!msg) return [];

    const types = [
        'extendedTextMessage',
        'imageMessage',
        'videoMessage',
        'audioMessage',
        'documentMessage',
        'stickerMessage',
        'buttonsMessage',
        'templateMessage',
        'listMessage'
    ];

    for (const type of types) {
        const mentioned = msg[type]?.contextInfo?.mentionedJid;
        if (mentioned && mentioned.length > 0) return mentioned;
    }

    return [];
}

async function antistatusmentionCommand(sock, chatId, message) {
    try {
        if (!chatId.endsWith('@g.us')) {
            await sock.sendMessage(chatId, {
                text: "❌ *Group Command Only*\n\nThis command can only be used in groups!",
                mentions: [message.key.participant || message.key.remoteJid]
            }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, { react: { text: '🛡️', key: message.key } });

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        const parts = text.split(' ');
        const query = parts.slice(1).join(' ').trim();

        const groupMetadata = await sock.groupMetadata(chatId).catch(() => null);
        if (!groupMetadata) {
            return await sock.sendMessage(chatId, {
                text: "❌ *Error*\n\nFailed to fetch group metadata!",
                mentions: [message.key.participant || message.key.remoteJid]
            }, { quoted: message });
        }

        const userId = message.key.participant || message.key.remoteJid;
        const adminResult = await isAdmin(sock, chatId, userId);

        if (!adminResult.isSenderAdmin) {
            await sock.sendMessage(chatId, {
                text: "❌ *Admin Only*\n\nThis command is only for group admins!",
                mentions: [userId]
            }, { quoted: message });
            return;
        }

        if (!adminResult.isBotAdmin) {
            await sock.sendMessage(chatId, {
                text: "❌ *Bot Admin Required*\n\nPlease make the bot an admin first!",
                mentions: [userId]
            }, { quoted: message });
            return;
        }

        const settings = await getAntiStatusMentionSettings(chatId);

        if (!query) {
            const statusMap = {
                'off': '❌ OFF',
                'warn': '⚠️ WARN',
                'delete': '🗑️ DELETE',
                'remove': '🚫 REMOVE'
            };
            const totalWarned = antiStatusMentionData.warns[chatId] ? Object.keys(antiStatusMentionData.warns[chatId]).length : 0;
            return await sock.sendMessage(chatId, {
                text: `*🛡️ Anti-Status-Mention Settings*\n\n` +
                      `┌ *Current Settings*\n` +
                      `│ Status: ${statusMap[settings.action]}\n` +
                      `│ Limit: ${settings.warn_limit}\n` +
                      `│ Warned: ${totalWarned}\n` +
                      `└──────────────\n\n` +
                      `*📝 Commands:*\n` +
                      `▸ *off* - Disable feature\n` +
                      `▸ *warn* - Warn users (kick on limit)\n` +
                      `▸ *delete* - Delete only\n` +
                      `▸ *remove* - Delete + remove users\n` +
                      `▸ *limit 1-10* - Set warn limit\n` +
                      `▸ *resetwarns* - Clear all warns\n` +
                      `▸ *status* - Show settings\n\n` +
                      `*ℹ️ Group Command Only*`,
                mentions: [userId]
            }, { quoted: message });
        }

        const args = query.split(/\s+/);
        const subcommand = args[0]?.toLowerCase();
        const value = args[1];

        switch (subcommand) {
            case 'off':
            case 'warn':
            case 'delete':
            case 'remove':
                await updateAntiStatusMentionSettings(chatId, { status: subcommand, action: subcommand });
                await sock.sendMessage(chatId, {
                    text: `✅ *Settings Updated*\n\nAnti-status-mention has been set to: *${subcommand.toUpperCase()}*\n\n*Group:* ${groupMetadata.subject}`,
                    mentions: [userId]
                }, { quoted: message });
                break;

            case 'limit':
                const limit = parseInt(value);
                if (isNaN(limit) || limit < 1 || limit > 10) {
                    await sock.sendMessage(chatId, {
                        text: "❌ *Invalid Limit*\n\nPlease use a number between 1 and 10 only!",
                        mentions: [userId]
                    }, { quoted: message });
                    return;
                }
                await updateAntiStatusMentionSettings(chatId, { warn_limit: limit });
                await sock.sendMessage(chatId, {
                    text: `✅ *Limit Updated*\n\nWarn limit has been set to: *${limit}*\n\n*Group:* ${groupMetadata.subject}`,
                    mentions: [userId]
                }, { quoted: message });
                break;

            case 'resetwarns':
                await clearAllStatusWarns(chatId);
                await sock.sendMessage(chatId, {
                    text: `✅ *Warns Reset*\n\nAll status mention warns have been cleared for this group.\n\n*Group:* ${groupMetadata.subject}`,
                    mentions: [userId]
                }, { quoted: message });
                break;

            case 'status':
            case 'info':
                const currentSettings = await getAntiStatusMentionSettings(chatId);
                const statusMap2 = {
                    'off': '❌ OFF',
                    'warn': '⚠️ WARN',
                    'delete': '🗑️ DELETE',
                    'remove': '🚫 REMOVE'
                };
                const totalWarned2 = antiStatusMentionData.warns[chatId] ? Object.keys(antiStatusMentionData.warns[chatId]).length : 0;
                await sock.sendMessage(chatId, {
                    text: `*📊 Anti-Status-Mention Status*\n\n` +
                          `┌ *Group Information*\n` +
                          `│ Name: ${groupMetadata.subject}\n` +
                          `│ ID: ${chatId}\n` +
                          `├ *Current Settings*\n` +
                          `│ Status: ${statusMap2[currentSettings.action]}\n` +
                          `│ Limit: ${currentSettings.warn_limit}\n` +
                          `│ Warned: ${totalWarned2}\n` +
                          `└──────────────`,
                    mentions: [userId]
                }, { quoted: message });
                break;

            default:
                await sock.sendMessage(chatId, {
                    text: "❌ *Invalid Command*\n\nAvailable commands:\n▸ off/warn/delete/remove\n▸ limit 1-10\n▸ resetwarns\n▸ status",
                    mentions: [userId]
                }, { quoted: message });
                break;
        }
    } catch (error) {
        console.error("\x1b[35m[AntiStatusMention] Error:\x1b[0m", error);
        await sock.sendMessage(chatId, {
            text: `🚫 *Error*\n\n${error.message}`,
            mentions: [message.key.participant || message.key.remoteJid]
        }, { quoted: message });
    }
}

async function handleAntiStatusMention(sock, message) {
    try {
        const chatId = message.key.remoteJid;

        if (!chatId.endsWith('@g.us')) return;

        const settings = await getAntiStatusMentionSettings(chatId);
        if (settings.action === 'off') return;

        const mentionedJid = getMentionedJids(message);
        if (!mentionedJid.includes('status@broadcast')) return;

        const userId = message.key.participant || message.key.remoteJid;

        const adminResult = await isAdmin(sock, chatId, userId);
        if (adminResult.isSenderAdmin) return;

        if (!adminResult.isBotAdmin) return;

        const groupMetadata = await sock.groupMetadata(chatId).catch(() => null);
        const groupName = groupMetadata ? groupMetadata.subject : 'the group';

        switch (settings.action) {
            case 'warn': {
                const warnCount = await addUserStatusWarn(chatId, userId);

                try { await sock.sendMessage(chatId, { delete: message.key }); } catch (e) {
                    console.error('[AntiStatusMention] Delete failed:', e.message);
                }

                if (warnCount >= settings.warn_limit) {
                    await resetUserStatusWarns(chatId, userId);
                    try { await sock.groupParticipantsUpdate(chatId, [userId], 'remove'); } catch (e) {
                        console.error('[AntiStatusMention] Kick failed:', e.message);
                    }
                    await sock.sendMessage(chatId, {
                        text: `🚫 *Member Removed*\n\n` +
                              `@${userId.split('@')[0]} has been removed after reaching the warn limit for mentioning *@status*.\n\n` +
                              `┌ *Details*\n` +
                              `│ Warns: ${warnCount}/${settings.warn_limit}\n` +
                              `│ Group: ${groupName}\n` +
                              `└──────────────`,
                        mentions: [userId]
                    });
                } else {
                    await sock.sendMessage(chatId, {
                        text: `⚠️ *Status Mention Warning*\n\n` +
                              `@${userId.split('@')[0]} please don't mention *@status* in this group!\n\n` +
                              `┌ *Details*\n` +
                              `│ Warns: ${warnCount}/${settings.warn_limit}\n` +
                              `│ Group: ${groupName}\n` +
                              `└──────────────\n\n` +
                              `*📌 Note:* You will be removed when warns reach the limit!`,
                        mentions: [userId]
                    });
                }
                break;
            }

            case 'delete': {
                try {
                    await sock.sendMessage(chatId, { delete: message.key });
                    await sock.sendMessage(chatId, {
                        text: `🗑️ *Message Deleted*\n\n` +
                              `@${userId.split('@')[0]} your message was deleted because it contained an *@status* mention.\n\n` +
                              `*Group:* ${groupName}`,
                        mentions: [userId]
                    });
                } catch (e) {
                    console.error('[AntiStatusMention] Delete failed:', e.message);
                }
                break;
            }

            case 'remove': {
                try {
                    await sock.sendMessage(chatId, { delete: message.key });
                } catch (e) {
                    console.error('[AntiStatusMention] Delete failed:', e.message);
                }
                try {
                    await sock.groupParticipantsUpdate(chatId, [userId], 'remove');
                    await sock.sendMessage(chatId, {
                        text: `🚫 *Member Removed*\n\n` +
                              `@${userId.split('@')[0]} has been removed from the group for mentioning *@status*.\n\n` +
                              `*Group:* ${groupName}`,
                        mentions: [userId]
                    });
                } catch (e) {
                    console.error('[AntiStatusMention] Remove failed:', e.message);
                }
                break;
            }
        }
    } catch (error) {
        console.error("\x1b[35m[AntiStatusMention] Handler error:\x1b[0m", error);
    }
}

module.exports = {
    antistatusmentionCommand,
    handleAntiStatusMention
};
