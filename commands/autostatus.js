const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');
const { createFakeContact } = require('../lib/fakeContact');
const {
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
 * Mark a status as viewed and optionally react to it.
 *
 * Official Baileys v7 pattern:
 *   await sock.readMessages([msg.key])
 *   await sock.sendMessage('status@broadcast',
 *       { react: { text: '💖', key: msg.key } },
 *       { statusJidList: [msg.key.participant, sock.user.id] }
 *   )
 *
 * The raw participant JID (even a @lid JID) is passed directly —
 * Baileys resolves and encrypts for the correct device internally.
 */
async function processStatusMessage(sock, msg) {
    const msgKey = msg?.key;
    if (!msgKey?.id) return;
    if (!isJidStatusBroadcast(msgKey.remoteJid)) return;
    if (msgKey.fromMe) return;

    // Give Baileys a moment to finish storing the message
    await new Promise(r => setTimeout(r, 500));

    // ── Step 1: Mark status as viewed ──────────────────────────────────────
    // Pass the key exactly as received from the upsert event.
    // aggregateMessageKeysNotFromMe() inside readMessages() uses fromMe=false
    // to group by remoteJid:participant and sends the correct read receipt.
    try {
        await sock.readMessages([msgKey]);
    } catch (err) {
        if (err?.message?.includes('rate-overlimit')) {
            await new Promise(r => setTimeout(r, 3000));
            try { await sock.readMessages([msgKey]); } catch { /* ignore */ }
        }
        // All other errors are silently ignored — the status was still seen
    }

    // ── Step 2: React if enabled ────────────────────────────────────────────
    if (!isStatusReactionEnabled()) return;

    const participant = msgKey.participant;  // raw JID — may be @s.whatsapp.net or @lid
    if (!participant) return;

    const myId = sock.user?.id;
    if (!myId) return;

    // statusJidList tells Baileys which users to encrypt and deliver the
    // reaction message to. Use the raw participant (Baileys handles @lid
    // internally) plus our own normalised JID so our other devices see it.
    const statusJidList = [participant, jidNormalizedUser(myId)]
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i);  // deduplicate

    try {
        await sock.sendMessage(
            'status@broadcast',
            { react: { text: getEmoji(), key: msgKey } },
            { statusJidList }
        );
    } catch { /* ignore reaction errors */ }
}

/**
 * Main handler — called for every messages.upsert event that contains
 * status@broadcast messages.
 *
 * Accepts either:
 *   • chatUpdate object  { messages: [...], type: '...' }
 *   • bare message object { key: {...}, ... }
 */
async function handleStatusUpdate(sock, statusUpdate) {
    try {
        if (!isAutoStatusEnabled()) return;

        // Shape 1: chatUpdate with a messages array
        if (Array.isArray(statusUpdate?.messages)) {
            for (const msg of statusUpdate.messages) {
                if (isJidStatusBroadcast(msg?.key?.remoteJid)) {
                    await processStatusMessage(sock, msg);
                }
            }
            return;
        }

        // Shape 2: bare message object
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
