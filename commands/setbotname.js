const { isSudo } = require('../lib/index');

async function setBotNameCommand(sock, chatId, message, args) {
    try {
        await sock.sendMessage(chatId, { react: { text: "⚙️", key: message.key } });

        const senderId = message.key.participant || message.key.remoteJid;

        // Allow if message is from bot itself OR sender is sudo
        if (!(message.key.fromMe || await isSudo(senderId))) {
            return sock.sendMessage(chatId, { 
                text: "❌ Only bot owner can change bot name" 
            }, { quoted: message });
        }

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        const parts = text.split(' ').slice(1);

        if (parts.length < 1) {
            return sock.sendMessage(chatId, { 
                text: `📌 Usage: .setbotname <name>\n\nExample: .setbotname JUNE X` 
            }, { quoted: message });
        }

        const newBotName = parts.join(' ');

        // Update bot profile name
        await sock.updateProfileName(newBotName);

        return sock.sendMessage(chatId, { 
            text: `✅ Bot name changed to: *${newBotName}*` 
        }, { quoted: message });

    } catch (error) {
        console.error('Error in setBotNameCommand:', error);
        return sock.sendMessage(chatId, { 
            text: `❌ Error: ${error.message}` 
        }, { quoted: message }).catch(() => {});
    }
}

module.exports = setBotNameCommand;
