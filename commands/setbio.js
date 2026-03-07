const { isSudo } = require('../lib/index');

async function setBioCommand(sock, chatId, message, args) {
    const startTime = Date.now(); // start runtime measurement

    try {
        await sock.sendMessage(chatId, { react: { text: "⚙️", key: message.key } });

        const senderId = message.key.participant || message.key.remoteJid;

        // Allow if message is from bot itself OR sender is sudo
        if (!(message.key.fromMe || await isSudo(senderId))) {
            const runtime = Date.now() - startTime;
            return sock.sendMessage(chatId, { 
                text: `❌ Only bot owner can change bot bio (runtime: ${runtime}ms)` 
            }, { quoted: message });
        }

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        const parts = text.split(' ').slice(1);

        if (parts.length < 1) {
            const runtime = Date.now() - startTime;
            return sock.sendMessage(chatId, { 
                text: `📌 Usage: .setbio <text>\n\nExample: .setbio I'm a helpful WhatsApp bot\n(runtime: ${runtime}ms)` 
            }, { quoted: message });
        }

        const newBio = parts.join(' ');

        // Update bot profile status (bio)
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
