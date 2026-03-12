const {
    setAntilink,
    getAntilink,
    removeAntilink,
    incrementWarningCount,
    resetWarningCount
} = require('../lib/index');
const isAdmin = require('../lib/isAdmin');
const { createFakeContact } = require('../lib/fakeContact');

const WARN_LIMIT = 3; // kick after this many warnings

// ─── Link Detection ───────────────────────────────────────────────────────────

const LINK_PATTERNS = [
    // WhatsApp invite / channel / direct
    /chat\.whatsapp\.com\/[A-Za-z0-9+_-]{5,}/i,
    /wa\.me\/(?:channel\/)?[A-Za-z0-9+_-]{5,}/i,
    // Telegram
    /t\.me\/[A-Za-z0-9_+]{2,}/i,
    // Any http/https URL
    /https?:\/\/[^\s]{4,}/i,
    // www.domain.tld
    /(?:^|[\s(,])www\.[a-z0-9-]+\.[a-z]{2,}(?:[/?#][^\s]*)?/i,
    // Plain domain.tld/path — short URLs, youtu.be, bit.ly, tinyurl.com, etc.
    /(?:^|[\s(,])(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|me|app|ly|be|tv|uk|us|ng|ke|za|gh|rw|tz|ug|et|cm|sn|ci|ma|dz|tn|eg|to|link|xyz|online|site|web|info|biz|live|store|shop|tech|dev|ai|cloud|media|news|blog|click|win|club)(?:\/[^\s]*)?/i,
];

function containsLink(text) {
    if (!text || typeof text !== 'string') return false;
    return LINK_PATTERNS.some(p => p.test(text));
}

// Extract all possible text from a message (text, captions, link preview URL, etc.)
function getAllMessageText(message) {
    const msg = message.message || {};
    const parts = [
        msg.conversation,
        msg.extendedTextMessage?.text,
        msg.extendedTextMessage?.contextInfo?.matchedText,
        msg.imageMessage?.caption,
        msg.videoMessage?.caption,
        msg.documentMessage?.caption,
        msg.stickerMessage?.caption,
        msg.buttonsMessage?.contentText,
        msg.listMessage?.description,
        msg.templateMessage?.hydratedTemplate?.hydratedContentText,
    ];
    return parts.filter(Boolean).join(' ');
}

// ─── Command Handler ──────────────────────────────────────────────────────────

async function handleAntilinkCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message) {
    const fake = createFakeContact(message);
    try {
        if (!isSenderAdmin && !message?.key?.fromMe) {
            await sock.sendMessage(chatId, {
                text: '❌ Only group admins can use antilink settings.'
            }, { quoted: fake });
            return;
        }

        const rawText = getAllMessageText(message);
        const parts = rawText.trim().split(/\s+/);
        const args = parts.slice(1).map(a => a.toLowerCase());
        const action = args[0];

        if (!action) {
            const config = await getAntilink(chatId, 'on');
            const status = config?.enabled ? '✅ ON' : '❌ OFF';
            const currentAction = config?.action || 'delete';
            await sock.sendMessage(chatId, {
                text: `🔗 *Antilink Settings*\n\n` +
                      `Status: ${status}\n` +
                      `Action: *${currentAction}*\n` +
                      `Warn limit: *${WARN_LIMIT}* warnings before kick\n\n` +
                      `*Commands:*\n` +
                      `• \`.antilink on\` — Enable (default: delete)\n` +
                      `• \`.antilink off\` — Disable\n` +
                      `• \`.antilink set delete|warn|kick\` — Set action\n` +
                      `• \`.antilink get\` — Show current config\n` +
                      `• \`.antilink allow <link>\` — Whitelist a link\n` +
                      `• \`.antilink disallow <link>\` — Remove whitelist`
            }, { quoted: fake });
            return;
        }

        switch (action) {
            case 'on': {
                const existing = await getAntilink(chatId, 'on');
                if (existing?.enabled) {
                    await sock.sendMessage(chatId, { text: '⚠️ Antilink is already ON.' }, { quoted: fake });
                    return;
                }
                await setAntilink(chatId, 'on', 'delete');
                await sock.sendMessage(chatId, {
                    text: '✅ Antilink enabled. Default action: *delete*.\nUse `.antilink set warn|kick` to change the action.'
                }, { quoted: fake });
                break;
            }

            case 'off': {
                await removeAntilink(chatId, 'on');
                await sock.sendMessage(chatId, { text: '✅ Antilink disabled.' }, { quoted: fake });
                break;
            }

            case 'set': {
                const mode = args[1];
                if (!['delete', 'kick', 'warn'].includes(mode)) {
                    await sock.sendMessage(chatId, {
                        text: '❌ Invalid mode. Choose: `delete`, `kick`, or `warn`.'
                    }, { quoted: fake });
                    return;
                }
                await setAntilink(chatId, 'on', mode);
                await sock.sendMessage(chatId, {
                    text: `✅ Antilink action set to *${mode}*.${mode === 'warn' ? `\nUsers will be kicked after *${WARN_LIMIT}* warnings.` : ''}`
                }, { quoted: fake });
                break;
            }

            case 'get': {
                const config = await getAntilink(chatId, 'on');
                if (!config) {
                    await sock.sendMessage(chatId, {
                        text: '*Antilink Config*\nStatus: ❌ OFF\nAction: —\nAllowed links: 0'
                    }, { quoted: fake });
                    return;
                }
                const allowedRaw = await getAntilink(chatId, 'allowed');
                const allowedList = Array.isArray(allowedRaw) ? allowedRaw : [];
                let text = `*Antilink Config*\n` +
                           `Status: ${config.enabled ? '✅ ON' : '❌ OFF'}\n` +
                           `Action: *${config.action || '—'}*\n` +
                           `Warn limit: *${WARN_LIMIT}*\n` +
                           `Allowed links: ${allowedList.length}`;
                if (allowedList.length > 0) {
                    text += '\n\n*Whitelisted:*\n' + allowedList.map((l, i) => `${i + 1}. ${l}`).join('\n');
                }
                await sock.sendMessage(chatId, { text }, { quoted: fake });
                break;
            }

            case 'allow': {
                const link = parts.slice(2).join(' ').trim();
                if (!link) {
                    await sock.sendMessage(chatId, { text: '❌ Usage: `.antilink allow <link>`' }, { quoted: fake });
                    return;
                }
                const config = await getAntilink(chatId, 'on');
                if (!config?.enabled) {
                    await sock.sendMessage(chatId, { text: '❌ Enable antilink first with `.antilink on`.' }, { quoted: fake });
                    return;
                }
                let cleanLink;
                try {
                    const url = new URL(link.startsWith('http') ? link : `https://${link}`);
                    cleanLink = (url.hostname + url.pathname).replace(/\/$/, '');
                } catch {
                    cleanLink = link.toLowerCase();
                }
                const existing = await getAntilink(chatId, 'allowed') || [];
                const allowedList = Array.isArray(existing) ? existing : [];
                if (allowedList.includes(cleanLink)) {
                    await sock.sendMessage(chatId, { text: `⚠️ Already whitelisted: \`${cleanLink}\`` }, { quoted: fake });
                    return;
                }
                allowedList.push(cleanLink);
                await setAntilink(chatId, 'allowed', allowedList);
                await sock.sendMessage(chatId, { text: `✅ Whitelisted: \`${cleanLink}\`` }, { quoted: fake });
                break;
            }

            case 'disallow':
            case 'remove': {
                const link = parts.slice(2).join(' ').trim();
                if (!link) {
                    await sock.sendMessage(chatId, { text: '❌ Usage: `.antilink disallow <link>`' }, { quoted: fake });
                    return;
                }
                const existing = await getAntilink(chatId, 'allowed') || [];
                const allowedList = Array.isArray(existing) ? existing : [];
                const idx = allowedList.findIndex(a =>
                    a.toLowerCase().includes(link.toLowerCase()) ||
                    link.toLowerCase().includes(a.toLowerCase())
                );
                if (idx === -1) {
                    await sock.sendMessage(chatId, { text: `❌ Not found in whitelist: \`${link}\`` }, { quoted: fake });
                    return;
                }
                const removed = allowedList.splice(idx, 1)[0];
                await setAntilink(chatId, 'allowed', allowedList);
                await sock.sendMessage(chatId, { text: `✅ Removed from whitelist: \`${removed}\`` }, { quoted: fake });
                break;
            }

            default:
                await sock.sendMessage(chatId, {
                    text: '❌ Unknown subcommand. Use `.antilink` to see options.'
                }, { quoted: fake });
        }

    } catch (error) {
        console.error('[Antilink] Command error:', error);
        await sock.sendMessage(chatId, { text: '❌ Error processing antilink command.' }, { quoted: fake });
    }
}

// ─── Per-Message Link Detection ───────────────────────────────────────────────

async function handleLinkDetection(sock, chatId, message, userMessage, senderId) {
    try {
        // Skip bot's own messages
        if (message.key.fromMe) return;

        // Only process group messages
        if (!chatId.endsWith('@g.us')) return;

        // Check if antilink is enabled
        const antilinkConfig = await getAntilink(chatId, 'on');
        if (!antilinkConfig?.enabled) return;

        // Gather all text from this message
        const fullText = getAllMessageText(message);
        if (!fullText) return;

        // Check for any link type
        if (!containsLink(fullText)) return;

        // Skip group admins and check bot is admin
        const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);
        if (isSenderAdmin) return;
        if (!isBotAdmin) return; // Can't enforce without bot being admin

        // Skip whitelisted links
        const allowedRaw = await getAntilink(chatId, 'allowed');
        const allowedLinks = Array.isArray(allowedRaw) ? allowedRaw : [];
        if (allowedLinks.length > 0) {
            const lowerText = fullText.toLowerCase();
            if (allowedLinks.some(a => lowerText.includes(a.toLowerCase()))) return;
        }

        // Message key for deletion
        const msgKey = {
            remoteJid: chatId,
            fromMe: false,
            id: message.key.id,
            participant: message.key.participant || senderId
        };

        const mention = `@${senderId.split('@')[0]}`;

        switch (antilinkConfig.action) {
            case 'delete': {
                try { await sock.sendMessage(chatId, { delete: msgKey }); } catch (e) {
                    console.error('[Antilink] Delete failed:', e.message);
                }
                await sock.sendMessage(chatId, {
                    text: `🚫 ${mention} Links are not allowed in this group.`,
                    mentions: [senderId]
                });
                break;
            }

            case 'kick': {
                try { await sock.sendMessage(chatId, { delete: msgKey }); } catch (e) {
                    console.error('[Antilink] Delete (kick) failed:', e.message);
                }
                try {
                    await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
                    await sock.sendMessage(chatId, {
                        text: `🚫 ${mention} was removed for posting a link.`,
                        mentions: [senderId]
                    });
                } catch (e) {
                    console.error('[Antilink] Kick failed:', e.message);
                    await sock.sendMessage(chatId, {
                        text: `⚠️ ${mention} Links are not allowed here. (Failed to remove — check bot admin rights.)`,
                        mentions: [senderId]
                    });
                }
                break;
            }

            case 'warn': {
                try { await sock.sendMessage(chatId, { delete: msgKey }); } catch (e) {
                    console.error('[Antilink] Delete (warn) failed:', e.message);
                }
                const warnCount = await incrementWarningCount(chatId, senderId);
                if (warnCount >= WARN_LIMIT) {
                    await resetWarningCount(chatId, senderId);
                    try {
                        await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
                        await sock.sendMessage(chatId, {
                            text: `🚫 ${mention} was removed after *${WARN_LIMIT}* link warnings.`,
                            mentions: [senderId]
                        });
                    } catch (e) {
                        console.error('[Antilink] Warn-kick failed:', e.message);
                        await sock.sendMessage(chatId, {
                            text: `❌ ${mention} reached ${WARN_LIMIT} warnings but could not be removed. Check bot admin permissions.`,
                            mentions: [senderId]
                        });
                    }
                } else {
                    await sock.sendMessage(chatId, {
                        text: `⚠️ ${mention} *Warning ${warnCount}/${WARN_LIMIT}:* No links allowed here.\n${WARN_LIMIT - warnCount} warning(s) remaining before removal.`,
                        mentions: [senderId]
                    });
                }
                break;
            }

            default: {
                // Fallback: delete only
                try { await sock.sendMessage(chatId, { delete: msgKey }); } catch (_) {}
                break;
            }
        }

    } catch (error) {
        console.error('[Antilink] Detection error:', error);
    }
}

module.exports = { handleAntilinkCommand, handleLinkDetection };
