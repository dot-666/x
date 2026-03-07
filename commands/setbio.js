const { isSudo } = require('../lib/index');

// Helper to format uptime (milliseconds → days, hours, minutes, seconds)
function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

async function setBioCommand(sock, chatId, message, args) {
    const startTime = Date.now(); // start runtime measurement

    try {
        // React to the command message
        await sock.sendMessage(chatId, { react: { text: "⚙️", key: message.key } });

        const senderId = message.key.participant || message.key.remoteJid;

        // Permission: only bot itself or sudo users can change bio
        if (!(message.key.fromMe || await isSudo(senderId))) {
            const runtime = Date.now() - startTime;
            return sock.sendMessage(chatId, { 
                text: `❌ Only bot owner can change bot bio (runtime: ${runtime}ms)` 
            }, { quoted: message });
        }

        // Extract command arguments from message text
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        const parts = text.split(' ').slice(1); // remove command name

        // Determine the new bio
        let newBio;
        if (parts.length === 0) {
            // No arguments → show usage
            const runtime = Date.now() - startTime;
            return sock.sendMessage(chatId, { 
                text: `📌 Usage: .setbio <text> or .setbio default\n\nExample: .setbio I'm a helpful WhatsApp bot\n(runtime: ${runtime}ms)` 
            }, { quoted: message });
        } else {
            const input = parts.join(' ').trim();
            if (input.toLowerCase() === 'default') {
                // Set bio to default uptime string
                // Assumes global.botStartTime is set when the bot starts
                const uptime = Date.now() - global.botStartTime;
                newBio = `JUNE MD running for ${formatUptime(uptime)}`;
            } else {
                newBio = input;
            }
        }

        // Update the profile "about" (status) via Baileys method
        await sock.updateProfileStatus(newBio);

        const runtime = Date.now() - startTime;
        return sock.sendMessage(chatId, { 
            text: `✅ Bot bio changed to: *${newBio}*\n⏱️ Runtime: ${runtime}ms` 
        }, { quoted: message });

    } catch (error) {
        console.error('Error in setBioCommand:', error);
        const runtime = Date.now() - startTime;
        return sock.sendMessage(chatId, { 
            text: `❌ Error: ${error.message}\n⏱️ Runtime: ${runtime}ms` 
        }, { quoted: message }).catch(() => {});
    }
}

module.exports = setBioCommand;
