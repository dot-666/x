/**
 * Antilink — complete recode
 * Storage  : data/antilink.json  (self-contained, no shared-lib dependency)
 * Detection: per-message hook called from main.js for all incoming group messages
 *
 * KEY FIX: link regex uses a literal /pattern/ not new RegExp(string) to avoid
 * backslash-escaping bugs that turned \. into . (any char) and caused every
 * normal word to be treated as a URL.
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const isAdmin = require('../lib/isAdmin');

const DATA_FILE  = path.join(__dirname, '../data/antilink.json');
const WARN_LIMIT = 3;

// ─── Storage ──────────────────────────────────────────────────────────────────

function load() {
    try {
        if (!fs.existsSync(DATA_FILE)) return {};
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}');
    } catch { return {}; }
}

function save(data) {
    try {
        const dir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (e) { console.error('[Antilink] Save error:', e.message); }
}

function getGroup(groupId) {
    return load()[groupId] || null;
}

function setGroup(groupId, patch) {
    const data = load();
    data[groupId] = Object.assign({}, data[groupId] || {}, patch);
    save(data);
}

function deleteGroup(groupId) {
    const data = load();
    delete data[groupId];
    save(data);
}

// ─── Link Detection ───────────────────────────────────────────────────────────
//
// Using a LITERAL regex so that \. means "literal dot" and \s means "whitespace".
// Covers: http(s) URLs, www.x.x, WhatsApp, Telegram, short-URLs (bit.ly, youtu.be…)
//
const LINK_RE = /(?:https?:\/\/[^\s<>"']{4,}|(?:www\.|chat\.whatsapp\.com\/|wa\.me\/|t\.me\/)[^\s<>"']{3,}|(?:[a-z0-9][a-z0-9-]*\.)+(?:com|net|org|io|co|me|app|ly|be|tv|uk|us|ng|ke|za|gh|rw|tz|ug|et|cm|sn|ci|ma|dz|tn|eg|to|xyz|online|site|web|info|biz|live|store|shop|tech|dev|ai|cloud|media|news|blog|click|win|club|gl)(?:\/[^\s]*)?)/i;

function textHasLink(text) {
    if (!text || typeof text !== 'string') return false;
    return LINK_RE.test(text);
}

// Extract the plain-text body from any WhatsApp message type
function extractText(message) {
    const m = message?.message || {};
    return (
        m.conversation                                  ||
        m.extendedTextMessage?.text                     ||
        m.imageMessage?.caption                         ||
        m.videoMessage?.caption                         ||
        m.documentMessage?.caption                      ||
        m.extendedTextMessage?.contextInfo?.matchedText ||
        ''
    );
}

// ─── Command Handler ──────────────────────────────────────────────────────────

/**
 * Called from main.js switch:
 *   handleAntilinkCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message)
 *
 * userMessage is already lower-cased, e.g. ".antilink on" or ".antilink set warn"
 */
async function handleAntilinkCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message) {
    if (!isSenderAdmin && !message?.key?.fromMe) {
        await sock.sendMessage(chatId, {
            text: '❌ Only group admins can configure antilink.'
        }, { quoted: message });
        return;
    }

    const parts = userMessage.trim().split(/\s+/);
    const sub   = parts[1];        // on | off | set | get | allow | disallow
    const arg   = parts[2];        // delete | warn | kick  OR  the link text

    // ── Show help ─────────────────────────────────────────────────────────────
    if (!sub) {
        const cfg = getGroup(chatId);
        await sock.sendMessage(chatId, {
            text:
                `🔗 *Antilink*\n\n` +
                `Status : ${cfg?.enabled ? '✅ ON' : '❌ OFF'}\n` +
                `Action : *${cfg?.action || '—'}*\n` +
                `Warn   : kick after *${WARN_LIMIT}* warnings\n\n` +
                `*Commands*\n` +
                `• .antilink on\n` +
                `• .antilink off\n` +
                `• .antilink set delete|warn|kick\n` +
                `• .antilink get\n` +
                `• .antilink allow <link>\n` +
                `• .antilink disallow <link>`
        }, { quoted: message });
        return;
    }

    switch (sub) {

        // ── on ───────────────────────────────────────────────────────────────
        case 'on': {
            const cur = getGroup(chatId);
            if (cur?.enabled) {
                await sock.sendMessage(chatId, { text: '⚠️ Antilink is already ON.' }, { quoted: message });
                return;
            }
            setGroup(chatId, {
                enabled:  true,
                action:   cur?.action   || 'delete',
                warnings: cur?.warnings || {}
            });
            const cfg = getGroup(chatId);
            await sock.sendMessage(chatId, {
                text: `✅ Antilink *enabled*.\nAction: *${cfg.action}*\nUse \`.antilink set delete|warn|kick\` to change.`
            }, { quoted: message });
            break;
        }

        // ── off ──────────────────────────────────────────────────────────────
        case 'off': {
            deleteGroup(chatId);
            await sock.sendMessage(chatId, { text: '✅ Antilink *disabled*.' }, { quoted: message });
            break;
        }

        // ── set <action> ─────────────────────────────────────────────────────
        case 'set': {
            if (!['delete', 'warn', 'kick'].includes(arg)) {
                await sock.sendMessage(chatId, {
                    text: '❌ Usage: `.antilink set delete|warn|kick`'
                }, { quoted: message });
                return;
            }
            setGroup(chatId, { action: arg });
            await sock.sendMessage(chatId, {
                text: `✅ Antilink action set to *${arg}*.` +
                      (arg === 'warn' ? `\nKick after *${WARN_LIMIT}* warnings.` : '')
            }, { quoted: message });
            break;
        }

        // ── get ──────────────────────────────────────────────────────────────
        case 'get': {
            const cfg = getGroup(chatId);
            if (!cfg?.enabled) {
                await sock.sendMessage(chatId, { text: '🔗 Antilink: ❌ OFF' }, { quoted: message });
                return;
            }
            const wl = cfg.allowed || [];
            let text =
                `*Antilink Config*\n` +
                `Status  : ✅ ON\n` +
                `Action  : *${cfg.action}*\n` +
                `Warn at : ${WARN_LIMIT}\n` +
                `Whitelist: ${wl.length}`;
            if (wl.length) text += '\n\n*Whitelisted:*\n' + wl.map((l, i) => `${i + 1}. ${l}`).join('\n');
            await sock.sendMessage(chatId, { text }, { quoted: message });
            break;
        }

        // ── allow <link> ─────────────────────────────────────────────────────
        case 'allow': {
            const link = parts.slice(2).join(' ').trim();
            if (!link) {
                await sock.sendMessage(chatId, { text: '❌ Usage: `.antilink allow <link>`' }, { quoted: message });
                return;
            }
            const cfg     = getGroup(chatId) || { enabled: false, action: 'delete', warnings: {}, allowed: [] };
            const allowed = cfg.allowed || [];
            if (allowed.some(l => l.toLowerCase() === link.toLowerCase())) {
                await sock.sendMessage(chatId, { text: `⚠️ Already whitelisted: ${link}` }, { quoted: message });
                return;
            }
            allowed.push(link);
            setGroup(chatId, { allowed });
            await sock.sendMessage(chatId, { text: `✅ Whitelisted: ${link}` }, { quoted: message });
            break;
        }

        // ── disallow / remove <link> ─────────────────────────────────────────
        case 'disallow':
        case 'remove': {
            const link = parts.slice(2).join(' ').trim();
            if (!link) {
                await sock.sendMessage(chatId, { text: '❌ Usage: `.antilink disallow <link>`' }, { quoted: message });
                return;
            }
            const cfg     = getGroup(chatId);
            const allowed = (cfg?.allowed || []).filter(l => !l.toLowerCase().includes(link.toLowerCase()));
            setGroup(chatId, { allowed });
            await sock.sendMessage(chatId, { text: `✅ Removed from whitelist: ${link}` }, { quoted: message });
            break;
        }

        default:
            await sock.sendMessage(chatId, { text: '❌ Unknown option. Use `.antilink` to see commands.' }, { quoted: message });
    }
}

// ─── Per-Message Detection ────────────────────────────────────────────────────

/**
 * Called by main.js for every incoming group message.
 * Signature: handleLinkDetection(sock, chatId, message, userMessage, senderId)
 */
async function handleLinkDetection(sock, chatId, message, userMessage, senderId) {
    try {
        if (message.key.fromMe) return;
        if (!chatId.endsWith('@g.us')) return;

        const cfg = getGroup(chatId);
        if (!cfg?.enabled) return;

        const text = extractText(message);
        if (!text || !textHasLink(text)) return;

        // Admins are exempt; bot must be admin to act
        const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);
        if (isSenderAdmin) return;
        if (!isBotAdmin) {
            console.warn('[Antilink] Bot is not admin in', chatId, '— cannot enforce');
            return;
        }

        // Whitelist check
        const whitelist = cfg.allowed || [];
        if (whitelist.length && whitelist.some(w => text.toLowerCase().includes(w.toLowerCase()))) return;

        // Key to delete the offending message
        const delKey = {
            remoteJid:   chatId,
            fromMe:      false,
            id:          message.key.id,
            participant: message.key.participant || senderId
        };

        const tag    = `@${senderId.split('@')[0]}`;
        const action = cfg.action || 'delete';

        // Delete first
        try { await sock.sendMessage(chatId, { delete: delKey }); }
        catch (e) { console.error('[Antilink] Delete failed:', e.message); }

        if (action === 'delete') {
            await sock.sendMessage(chatId, {
                text: `🚫 ${tag}, links are not allowed in this group.`,
                mentions: [senderId]
            });

        } else if (action === 'kick') {
            try {
                await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
                await sock.sendMessage(chatId, {
                    text: `🚫 ${tag} was removed for posting a link.`,
                    mentions: [senderId]
                });
            } catch (e) {
                console.error('[Antilink] Kick failed:', e.message);
                await sock.sendMessage(chatId, {
                    text: `⚠️ ${tag}, links are not allowed. (Could not remove — check bot admin permissions.)`,
                    mentions: [senderId]
                });
            }

        } else if (action === 'warn') {
            const warnings = cfg.warnings || {};
            warnings[senderId] = (warnings[senderId] || 0) + 1;
            const count = warnings[senderId];

            if (count >= WARN_LIMIT) {
                warnings[senderId] = 0;
                setGroup(chatId, { warnings });
                try {
                    await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
                    await sock.sendMessage(chatId, {
                        text: `🚫 ${tag} was removed after ${WARN_LIMIT} link warnings.`,
                        mentions: [senderId]
                    });
                } catch (e) {
                    console.error('[Antilink] Warn-kick failed:', e.message);
                    await sock.sendMessage(chatId, {
                        text: `❌ ${tag} reached ${WARN_LIMIT} warnings but could not be removed. Check bot admin permissions.`,
                        mentions: [senderId]
                    });
                }
            } else {
                setGroup(chatId, { warnings });
                await sock.sendMessage(chatId, {
                    text: `⚠️ ${tag} *Warning ${count}/${WARN_LIMIT}* — no links allowed.\n${WARN_LIMIT - count} warning(s) left before removal.`,
                    mentions: [senderId]
                });
            }
        }

    } catch (err) {
        console.error('[Antilink] Detection error:', err);
    }
}

module.exports = { handleAntilinkCommand, handleLinkDetection };
