const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');
const { createFakeContact } = require('../lib/fakeContact');
const { isLidUser, jidDecode } = require('@whiskeysockets/baileys');

const configPath = path.join(__dirname, '../data/autoStatus.json');

if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ enabled: false, reactOn: false }, null, 2));
}

function readConfig() {
    try { return JSON.parse(fs.readFileSync(configPath)); }
    catch { return { enabled: false, reactOn: false }; }
}

function writeConfig(config) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function isAutoStatusEnabled() { return readConfig().enabled; }
function isStatusReactionEnabled() { return readConfig().reactOn; }

const reactionEmojis = [
    '💞', '💘', '🥰', '💙', '💓', '💕',
    '❤️', '🧡', '💛', '💚', '💜', '❤️‍🔥',
    '😍', '🤩', '😘', '🥳', '😎', '🫶',
    '🔥', '✨', '💫', '⭐', '🌟', '🎉',
    '😂', '🤣', '👍', '💯', '🏆', '🚀'
];

function randomEmoji() {
    const custom = readConfig().emoji;
    if (custom) return custom;
    return reactionEmojis[Math.floor(Math.random() * reactionEmojis.length)];
}

/**
 * Resolve a @lid JID to its @s.whatsapp.net phone JID.
 * Baileys stores the reverse mapping as:
 *   key type: 'lid-mapping', key name: '${lidUser}_reverse' → pnUser (phone number)
 * Returns the resolved JID or null if not found.
 */
async function resolveLid(sock, lidJid) {
    try {
        if (!lidJid || !isLidUser(lidJid)) return lidJid;
        const decoded = jidDecode(lidJid);
        if (!decoded) return null;
        const lidUser = decoded.user;
        const device = decoded.device ?? 0;
        const reverseKey = `${lidUser}_reverse`;
        const stored = await sock.authState.keys.get('lid-mapping', [reverseKey]);
        const pnUser = stored?.[reverseKey];
        if (!pnUser) return null;
        return `${pnUser}:${device}@s.whatsapp.net`;
    } catch {
        return null;
    }
}

/**
 * Build a resolved message key — if participant is @lid, resolve to phone JID.
 * Falls back to the original key if resolution fails.
 */
async function resolveKey(sock, msgKey) {
    if (!msgKey.participant || !isLidUser(msgKey.participant)) return msgKey;
    const resolved = await resolveLid(sock, msgKey.participant);
    if (!resolved) return msgKey; // keep original if can't resolve
    return { ...msgKey, participant: resolved };
}

/**
 * React to a status using the correct Baileys API.
 * statusJidList must contain @s.whatsapp.net JIDs only.
 */
async function reactToStatus(sock, resolvedKey, statusJidList) {
    try {
        if (!isStatusReactionEnabled()) return;
        if (!statusJidList || statusJidList.length === 0) return;
        const emoji = randomEmoji();
        await sock.sendMessage(
            'status@broadcast',
            { react: { text: emoji, key: resolvedKey } },
            { statusJidList }
        );
    } catch (err) {
        console.error('❌ Error reacting to status:', err.message);
    }
}

/**
 * Main handler — called for every incoming status broadcast event.
 * Handles three event shapes Baileys may emit.
 */
async function handleStatusUpdate(sock, status) {
    try {
        if (!isAutoStatusEnabled()) return;

        // Normalise different Baileys event shapes
        let rawKey = null;
        if (Array.isArray(status.messages) && status.messages.length > 0) {
            const m = status.messages[0];
            if (m?.key?.remoteJid === 'status@broadcast') rawKey = m.key;
        } else if (status.key?.remoteJid === 'status@broadcast') {
            rawKey = status.key;
        } else if (status.reaction?.key?.remoteJid === 'status@broadcast') {
            rawKey = status.reaction.key;
        }

        if (!rawKey) return;

        // Resolve @lid participant → @s.whatsapp.net so readMessages works
        const resolvedMsgKey = await resolveKey(sock, rawKey);

        // Build a clean statusJidList — only @s.whatsapp.net JIDs accepted by WA
        const ownJid = sock.user?.id || '';
        const participant = resolvedMsgKey.participant || '';
        const jidList = [ownJid, participant].filter(j => {
            if (!j || typeof j !== 'string') return false;
            if (j === 'status@broadcast') return false;
            if (isLidUser(j)) return false;
            return true;
        });

        // Small delay to let WhatsApp settle the key
        await new Promise(r => setTimeout(r, 800));

        // Mark status as viewed
        try {
            await sock.readMessages([resolvedMsgKey]);
        } catch (err) {
            if (err.message?.includes('rate-overlimit')) {
                await new Promise(r => setTimeout(r, 3000));
                try { await sock.readMessages([resolvedMsgKey]); } catch {}
            } else {
                console.error('❌ readMessages failed:', err.message);
            }
        }

        // React if enabled and we have valid JIDs
        if (isStatusReactionEnabled() && jidList.length > 0) {
            await reactToStatus(sock, resolvedMsgKey, jidList);
        }

    } catch (err) {
        console.error('❌ Error in handleStatusUpdate:', err.message);
    }
}

// Command handler
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
            const emojiDisplay = config.emoji ? config.emoji : 'random 🎲';
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
                await sock.sendMessage(chatId, { text: '❌ Use: `.autostatus react on` or `.autostatus react off`' }, { quoted: fake });
            }
        } else if (cmd === 'set') {
            const value = args[1];
            if (!value) {
                await sock.sendMessage(chatId, { text: '❌ Use: `.autostatus set 🔥` or `.autostatus set random`' }, { quoted: fake });
                return;
            }
            if (value.toLowerCase() === 'random') {
                delete config.emoji;
                writeConfig(config);
                await sock.sendMessage(chatId, { text: '🎲 Reaction emoji set to *random* — a different emoji will be used each time.' }, { quoted: fake });
            } else if (/\p{Emoji}/u.test(value)) {
                config.emoji = value;
                writeConfig(config);
                await sock.sendMessage(chatId, { text: `✅ Reaction emoji set to *${value}* — all status reactions will use this emoji.` }, { quoted: fake });
            } else {
                await sock.sendMessage(chatId, { text: '❌ That doesn\'t look like an emoji. Try: `.autostatus set 🔥`' }, { quoted: fake });
            }
        } else {
            await sock.sendMessage(chatId, {
                text: '❌ Unknown option.\n\nUse:\n`.autostatus on/off`\n`.autostatus react on/off`\n`.autostatus set 🔥`'
            }, { quoted: fake });
        }

    } catch (err) {
        console.error('Error in autoStatusCommand:', err);
        await sock.sendMessage(chatId, { text: '❌ Error: ' + err.message }, { quoted: createFakeContact(msg) });
    }
}

module.exports = { autoStatusCommand, handleStatusUpdate };
