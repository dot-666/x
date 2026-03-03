const { exec } = require("child_process");
const { isSudo } = require('../lib/index');   // Import the sudo check function

// Simple sleep function
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async function restartCommand(sock, chatId, message) {
    try {
        // Extract sender's JID from the message
        const sender = message.key.participant || message.key.remoteJid;

        // Authorisation check using isSudo (assumes it returns a boolean)
        if (!isSudo(sender)) {
            await sock.sendMessage(chatId, { text: "❌ Only the bot owner can use this command." }, { quoted: message });
            return;
        }

        // Notify restart and wait briefly
        await sock.sendMessage(chatId, { text: "🔄 Restarting JUNE X..." }, { quoted: message });
        await sleep(1500);

        // Execute restart command (adjust if your process manager differs)
        exec("pm2 restart all", (error, stdout, stderr) => {
            if (error) {
                console.error(`exec error: ${error}`);
            } else {
                // Attempt to send confirmation (note: bot may restart before this message is sent)
                sock.sendMessage(chatId, { text: "✅ Restart done" }, { quoted: message })
                    .catch(err => console.error("Failed to send restart done message:", err));
            }
            // stdout/stderr can be logged if needed
        });
    } catch (e) {
        console.error("Restart command error:", e);
        await sock.sendMessage(chatId, { text: `⚠️ Error: ${e.message}` }, { quoted: message });
    }
};
