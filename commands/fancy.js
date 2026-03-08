const axios = require('axios');

// Map to store reply handlers keyed by stanzaId
const replyHandlers = new Map();

// Command registry
const commands = { fancy: fancyCommand };

// Main listener registration
const { createFakeContact } = require('../lib/fakeContact');
function registerListeners(sock) {
    sock.ev.on("messages.upsert", async (update) => {
        const msg = update.messages[0];
        if (!msg.message) return;

        const stanzaId = msg.message.extendedTextMessage?.contextInfo?.stanzaId;
        if (stanzaId && replyHandlers.has(stanzaId)) {
            // Route to stored reply handler
            await replyHandlers.get(stanzaId)(msg);
            return;
        }

        // Otherwise, handle as a new command
        await handleMessage(sock, msg);
    });
}

// Command router
async function handleMessage(sock, msg) {
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
    if (!text) return;

    const [prefix, ...args] = text.trim().split(" ");
    if (prefix.startsWith(".")) {
        const cmd = prefix.slice(1).toLowerCase();
        if (commands[cmd]) {
            await commands[cmd](sock, msg.key.remoteJid, msg, args);
        }
    }
}

// Fancy command
async function fancyCommand(sock, chatId, message) {
    try {
        await sock.sendMessage(chatId, {
            react: { text: '✨', key: message.key }
        });

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        let query;
        if (text && text.startsWith('.fancy ')) {
            query = text.slice(7).trim();
        } else if (quoted) {
            query = quoted.conversation || quoted.extendedTextMessage?.text;
            if (!query) return await sock.sendMessage(chatId, { 
                text: '❌ Could not extract quoted text.' 
            }, { quoted: createFakeContact(message) });
        } else {
            return await sock.sendMessage(chatId, { 
                text: '📌 Provide text or reply to a message.\nExample: .fancy Hello' 
            }, { quoted: createFakeContact(message) });
        }

        if (!query) return await sock.sendMessage(chatId, { 
            text: '📌 Please provide text to convert to fancy style!' 
        }, { quoted: createFakeContact(message) });

        if (query.length > 200) return await sock.sendMessage(chatId, { 
            text: '📝 Text too long! Max 200 characters.' 
        }, { quoted: createFakeContact(message) });

        const apiBase = 'https://apiskeith.vercel.app';
        const apiUrl = `${apiBase}/fancytext/styles?q=${encodeURIComponent(query)}`;
        const { data } = await axios.get(apiUrl, { timeout: 30000 });

        if (!data || !Array.isArray(data.styles)) {
            return await sock.sendMessage(chatId, { 
                text: '❌ Failed to fetch fancy styles.' 
            }, { quoted: createFakeContact(message) });
        }

        let caption = `✨ Fancy styles for: *${data.input || query}*\n\n`;
        data.styles.forEach((style, i) => {
            caption += `${i + 1}. ${style.result || style.name}\n`;
        });
        caption += `\n📌 Reply with the style number to get the fancy text.`;

        const sent = await sock.sendMessage(chatId, { text: caption }, { quoted: createFakeContact(message) });
        const messageId = sent.key.id;

        // Store reply handler in map
        replyHandlers.set(messageId, async (msg) => {
            const responseText = msg.message.conversation || msg.message.extendedTextMessage?.text;
            const num = parseInt(responseText.trim(), 10);

            if (isNaN(num) || num < 1 || num > data.styles.length) {
                await sock.sendMessage(chatId, {
                    text: `❌ Invalid style number. Reply with a number between 1 and ${data.styles.length}.`,
                    quoted: msg
                });
                return sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
            }

            try {
                const index = num - 1;
                const styleUrl = `${apiBase}/fancytext?q=${encodeURIComponent(query)}&style=${index}`;
                const res = await axios.get(styleUrl, { timeout: 30000 });
                const styled = res.data?.result;

                if (!styled) {
                    await sock.sendMessage(chatId, {
                        text: "❌ Failed to generate fancy text.",
                        quoted: msg
                    });
                    return sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
                }

                await sock.sendMessage(chatId, { text: styled }, { quoted: msg });
                await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

                // Clean up handler
                replyHandlers.delete(messageId);

            } catch (err) {
                console.error("Fancy style error:", err);
                await sock.sendMessage(chatId, {
                    text: `❌ Error generating fancy text: ${err.message}`,
                    quoted: msg
                });
                await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
            }
        });

    } catch (error) {
        console.error("Fancy command error:", error);
        return await sock.sendMessage(chatId, { 
            text: `🚫 Error: ${error.message || "Failed to generate fancy text"}` 
        }, { quoted: createFakeContact(message) });
    }
}

module.exports = { registerListeners, fancyCommand };
