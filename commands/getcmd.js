const fs = require('fs');
const path = require('path');
const { createFakeContact } = require('../lib/fakeContact');
const isOwnerOrSudo = require('../lib/isOwner');

const COMMANDS_DIR = path.join(__dirname);
const MAX_MSG_LEN = 60000;

async function getcmdCommand(sock, chatId, msg, args) {
    try {
        const senderId = msg.key.participant || msg.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId);
        const fake = createFakeContact(msg);

        if (!msg.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, {
                text: '❌ Only the owner can use this command!'
            }, { quoted: fake });
            return;
        }

        // ── Mode: .getcmd <name> — send file contents ──────────────────────
        if (args && args.length > 0) {
            const target = args[0].replace(/\.js$/i, '').trim();
            const filePath = path.join(COMMANDS_DIR, `${target}.js`);

            if (!fs.existsSync(filePath)) {
                await sock.sendMessage(chatId, {
                    text: `❌ No command module named *${target}* found.`
                }, { quoted: fake });
                return;
            }

            const contents = fs.readFileSync(filePath, 'utf8');
            const header = `📄 *${target}.js*\n${'━'.repeat(20)}\n\n`;
            const full = header + contents;

            if (full.length <= MAX_MSG_LEN) {
                await sock.sendMessage(chatId, { text: full }, { quoted: fake });
            } else {
                // Split into chunks so we never exceed WhatsApp's limit
                let offset = 0;
                let part = 1;
                while (offset < full.length) {
                    const chunk = full.slice(offset, offset + MAX_MSG_LEN);
                    const label = part === 1 ? '' : `📄 *${target}.js* (part ${part})\n\n`;
                    await sock.sendMessage(chatId, { text: label + chunk }, { quoted: fake });
                    offset += MAX_MSG_LEN;
                    part++;
                }
            }
            return;
        }

        // ── Mode: .getcmd — show usage ─────────────────────────────────────
        await sock.sendMessage(chatId, {
            text: `📄 *getcmd usage*\n━━━━━━━━━━━━━━━━━━━━\n\nSend the name of a command module to view its source code.\n\n*Example:* \`.getcmd yts\``
        }, { quoted: fake });

    } catch (err) {
        await sock.sendMessage(chatId, {
            text: `❌ Error: ${err.message}`
        }, { quoted: createFakeContact(msg) });
    }
}

module.exports = { getcmdCommand };
