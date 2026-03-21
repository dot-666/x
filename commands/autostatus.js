const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');
const { createFakeContact } = require('../lib/fakeContact');
const {
    isLidUser,
    jidDecode,
    jidNormalizedUser,
    isJidStatusBroadcast
} = require('@whiskeysockets/baileys');

const configPath = path.join(__dirname, '../data/autoStatus.json');

if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ enabled: false, reactOn: false }, null, 2));
}

function readConfig() {
    try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
    catch { return { enabled: false, reactOn: false }; }
}

function writeConfig(cfg) {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}

function isAutoStatusEnabled() { return !!readConfig().enabled; }
function isStatusReactionEnabled() { return !!readConfig().reactOn; }

const REACTION_EMOJIS = [
    '💞', '💘', '🥰', '💙', '💓', '💕',
    '❤️', '🧡', '💛', '💚', '💜', '❤️‍🔥',
    '😍', '🤩', '😘', '🥳', '😎', '🫶',
    '🔥', '✨', '💫', '⭐', '🌟', '🎉',
    '😂', '🤣', '👍', '💯', '🏆', '🚀'
];

function getEmoji() {
    const custom = readConfig().emoji;
    return custom || REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)];
}

/**
 * Try to resolve a @lid JID to a @s.whatsapp.net JID.
 * Falls back to the original JID if resolution fails.
 */
async function resolveLidJid(sock, jid) {
    if (!jid || !isLidUser(jid)) return jid;
    try {
        const decoded = jidDecode(jid);
        if (!decoded?.user) return jid;
        const lidUser = decoded.user;
        const device = decoded.device ?? 0;

        const reverseKey = `${lidUser}_reverse`;
        const res1 = await sock.authState.keys.get('lid-mapping', [reverseKey]);
        if (res1?.[reverseKey]) {
            return `${res1[reverseKey]}:${device}@s.whatsapp.net`;
        }

        const res2 = await sock.authState.keys.get('lid-mapping', [lidUser]);
        if (res2?.[lidUser]) {
            return `${res2[lidUser]}:${device}@s.whatsapp.net`;
        }
    } catch { /* fall through */ }

    return jid;
}

/**
 * Mark a status as viewed and optionally react to it.
 * @param {object} sock - Baileys socket
 * @param {object} msg  - Full message object from messages.upsert
 */
async function processStatusMessage(sock, msg) {
    const msgKey = msg?.key;
    if (!msgKey?.id) return;
    if (!isJidStatusBroadcast(msgKey.remoteJid)) return;
    if (msgKey.fromMe) return;

    // Brief settle delay so Baileys finishes processing the message
    await new Promise(r => setTimeout(r, 500));

    // ── Step 1: Mark status as viewed ──────────────────────────────────────
    // Use the key exactly as received — do NOT mutate fromMe or participant.
    // Baileys' readMessages() handles status@broadcast keys natively.
    try {
        await sock.readMessages([msgKey]);
    } catch (err) {
        if (err?.message?.includes('rate-overlimit')) {
            await new Promise(r => setTimeout(r, 3000));
            try { await sock.readMessages([msgKey]); } catch { /* ignore */ }
        }
    }

    // ── Step 2: React if enabled ────────────────────────────────────────────
    if (!isStatusReactionEnabled()) return;

    // Build the statusJidList.
    // According to official Baileys docs the list must contain at least the
    // sender's normalised @s.whatsapp.net JID so WhatsApp delivers the receipt.
    const participant = msgKey.participant;
    if (!participant) return;

    const ownRaw = sock.user?.id || '';
    const ownJid = ownRaw ? jidNormalizedUser(ownRaw) : null;

    // Resolve @lid → @s.whatsapp.net when possible
    const resolvedSender = await resolveLidJid(sock, participant);

    // Normalise: only include verified @s.whatsapp.net JIDs
    const toNorm = (j) => {
        if (!j || typeof j !== 'string') return null;
        // Already normalised
        if (j.endsWith('@s.whatsapp.net')) return jidNormalizedUser(j);
        // LID we couldn't resolve — skip
        return null;
    };

    const statusJidList = [toNorm(resolvedSender), toNorm(ownJid)]
        .filter(Boolean)
        // Remove duplicates
        .filter((v, i, a) => a.indexOf(v) === i);

    // We need at least the sender to deliver the reaction receipt
    if (statusJidList.length === 0) return;

    try {
        await sock.sendMessage(
            'status@broadcast',
            { react: { text: getEmoji(), key: msgKey } },
            { statusJidList }
        );
    } catch { /* ignore reaction errors silently */ }
}

/**
 * Main handler — called for every messages.upsert event that contains status@broadcast.
 * Supports both the full chatUpdate object (with .messages array) and a bare message.
 */
async function handleStatusUpdate(sock, statusUpdate) {
    try {
        if (!isAutoStatusEnabled()) return;

        // Shape 1: full chatUpdate object { messages: [...], type: '...' }
        if (Array.isArray(statusUpdate?.messages)) {
            for (const msg of statusUpdate.messages) {
                if (isJidStatusBroadcast(msg?.key?.remoteJid)) {
                    await processStatusMessage(sock, msg);
                }
            }
            return;
        }

        // Shape 2: bare message object { key: { remoteJid, id, ... }, ... }
        if (statusUpdate?.key && isJidStatusBroadcast(statusUpdate.key.remoteJid)) {
            await processStatusMessage(sock, statusUpdate);
        }
    } catch { /* ignore top-level errors */ }
}

// ─── Command handler ───────────────────────────────────────────────────────────
async function autoStatusCommand(sock, chatId, msg, args) {
    try {
        const fake = createFakeContact(msg);
        const senderId = msg.key.participant || msg.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

        if (!msg.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, { text: '❌ Only the owner can use this!' }, { quoted: fake });
            return;
        }

        const config = readConfig();

        if (!args || args.length === 0) {
            const emojiDisplay = config.emoji || 'random 🎲';
            await sock.sendMessage(chatId, {
                text: `🔄 *Auto Status*\n\n` +
                      `📱 Auto View: *${config.enabled ? 'ON ✅' : 'OFF ❌'}*\n` +
                      `💫 Auto React: *${config.reactOn ? 'ON ✅' : 'OFF ❌'}*\n` +
                      `😀 React Emoji: *${emojiDisplay}*\n\n` +
                      `*Commands:*\n` +
                      `• \`.autostatus on\` — Enable viewing\n` +
                      `• \`.autostatus off\` — Disable viewing\n` +
                      `• \`.autostatus react on\` — Enable reactions\n` +
                      `• \`.autostatus react off\` — Disable reactions\n` +
                      `• \`.autostatus set 🔥\` — Set reaction emoji\n` +
                      `• \`.autostatus set random\` — Use random emoji`
            }, { quoted: fake });
            return;
        }

        const cmd = args[0].toLowerCase();

        if (cmd === 'on') {
            config.enabled = true;
            writeConfig(config);
            await sock.sendMessage(chatId, { text: '✅ Auto status view enabled!' }, { quoted: fake });

        } else if (cmd === 'off') {
            config.enabled = false;
            writeConfig(config);
            await sock.sendMessage(chatId, { text: '❌ Auto status view disabled!' }, { quoted: fake });

        } else if (cmd === 'react') {
            const sub = args[1]?.toLowerCase();
            if (sub === 'on') {
                config.reactOn = true;
                writeConfig(config);
                await sock.sendMessage(chatId, { text: '💫 Auto status reactions enabled!' }, { quoted: fake });
            } else if (sub === 'off') {
                config.reactOn = false;
                writeConfig(config);
                await sock.sendMessage(chatId, { text: '❌ Auto status reactions disabled!' }, { quoted: fake });
            } else {
                await sock.sendMessage(chatId, {
                    text: '❌ Use: `.autostatus react on` or `.autostatus react off`'
                }, { quoted: fake });
            }

        } else if (cmd === 'set') {
            const value = args[1];
            if (!value) {
                await sock.sendMessage(chatId, {
                    text: '❌ Use: `.autostatus set 🔥` or `.autostatus set random`'
                }, { quoted: fake });
                return;
            }
            if (value.toLowerCase() === 'random') {
                delete config.emoji;
                writeConfig(config);
                await sock.sendMessage(chatId, {
                    text: '🎲 Reaction emoji set to *random*.'
                }, { quoted: fake });
            } else if (/\p{Emoji}/u.test(value)) {
                config.emoji = value;
                writeConfig(config);
                await sock.sendMessage(chatId, {
                    text: `✅ Reaction emoji set to *${value}*`
                }, { quoted: fake });
            } else {
                await sock.sendMessage(chatId, {
                    text: '❌ Not a valid emoji. Try: `.autostatus set 🔥`'
                }, { quoted: fake });
            }

        } else {
            await sock.sendMessage(chatId, {
                text: '❌ Unknown option.\n\nUse:\n`.autostatus on/off`\n`.autostatus react on/off`\n`.autostatus set 🔥`'
            }, { quoted: fake });
        }

    } catch (err) {
        await sock.sendMessage(chatId, { text: '❌ Error: ' + err.message }, { quoted: createFakeContact(msg) });
    }
}

module.exports = { autoStatusCommand, handleStatusUpdate };
