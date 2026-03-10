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
 * Resolve a @lid JID to @s.whatsapp.net.
 * Tries two key formats in the auth store, falls back to the original JID.
 */
async function resolveLidJid(sock, jid) {
    if (!jid || !isLidUser(jid)) return jid;
    try {
        const decoded = jidDecode(jid);
        if (!decoded?.user) return jid;
        const lidUser = decoded.user;
        const device = decoded.device ?? 0;

        // Strategy 1: reverse mapping  (lidUser_reverse → phone number)
        const reverseKey = `${lidUser}_reverse`;
        const res1 = await sock.authState.keys.get('lid-mapping', [reverseKey]);
        if (res1?.[reverseKey]) {
            return `${res1[reverseKey]}:${device}@s.whatsapp.net`;
        }

        // Strategy 2: direct mapping  (lidUser → phone number)
        const res2 = await sock.authState.keys.get('lid-mapping', [lidUser]);
        if (res2?.[lidUser]) {
            return `${res2[lidUser]}:${device}@s.whatsapp.net`;
        }
    } catch { /* fall through */ }

    // Can't resolve — return as-is and let Baileys try internally
    return jid;
}

/**
 * Mark a single status as viewed and optionally react to it.
 */
async function processStatusMessage(sock, msgKey) {
    if (!msgKey?.id) return;
    if (!isJidStatusBroadcast(msgKey.remoteJid)) return;
    if (msgKey.fromMe) return; // skip our own status posts

    // Resolve @lid participant to phone JID
    const resolvedParticipant = await resolveLidJid(sock, msgKey.participant);
    const resolvedKey = { ...msgKey, participant: resolvedParticipant, fromMe: false };

    // Brief settle delay
    await new Promise(r => setTimeout(r, 500));

    // Mark as viewed
    try {
        await sock.readMessages([resolvedKey]);
        // Notification removed
    } catch (err) {
        if (err.message?.includes('rate-overlimit')) {
            await new Promise(r => setTimeout(r, 3000));
            try { await sock.readMessages([resolvedKey]); } catch { /* ignore */ }
        } else {
            // Error removed
        }
    }

    // React if enabled
    if (!isStatusReactionEnabled()) return;

    // Build statusJidList — only @s.whatsapp.net JIDs are accepted by WhatsApp
    const ownRaw = sock.user?.id || '';
    const ownJid = ownRaw ? jidNormalizedUser(ownRaw) : null;
    const senderJid = !isLidUser(resolvedParticipant) ? resolvedParticipant : null;
    const jidList = [ownJid, senderJid].filter(j =>
        j && typeof j === 'string' && j.endsWith('@s.whatsapp.net')
    );

    if (jidList.length === 0) return;

    try {
        await sock.sendMessage(
            'status@broadcast',
            { react: { text: getEmoji(), key: resolvedKey } },
            { statusJidList: jidList }
        );
    } catch (err) {
        // Error removed
    }
}

/**
 * Main handler — called for every messages.upsert event that has status@broadcast.
 * Processes every message in the batch.
 */
async function handleStatusUpdate(sock, statusUpdate) {
    try {
        if (!isAutoStatusEnabled()) return;

        // Shape 1: messages array (messages.upsert)
        if (Array.isArray(statusUpdate?.messages)) {
            for (const msg of statusUpdate.messages) {
                if (isJidStatusBroadcast(msg?.key?.remoteJid)) {
                    await processStatusMessage(sock, msg.key);
                }
            }
            return;
        }

        // Shape 2: bare key
        if (isJidStatusBroadcast(statusUpdate?.key?.remoteJid)) {
            await processStatusMessage(sock, statusUpdate.key);
            return;
        }

        // Shape 3: reaction wrapper
        if (isJidStatusBroadcast(statusUpdate?.reaction?.key?.remoteJid)) {
            await processStatusMessage(sock, statusUpdate.reaction.key);
        }
    } catch (err) {
        // Error removed
    }
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
