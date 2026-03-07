const { isSudo } = require('../lib/index');
const fs = require('fs').promises;
const path = require('path');
const settings = require('../settings');

// Path to your settings file (adjust based on your project structure)
const SETTINGS_PATH = path.join(__dirname, '../data/settings.json');

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

        // Ensure the data directory exists
        const dataDir = path.dirname(SETTINGS_PATH);
        try {
            await fs.access(dataDir);
        } catch {
            await fs.mkdir(dataDir, { recursive: true });
        }

        // Read current settings
        let settings = {};
        try {
            const data = await fs.readFile(SETTINGS_PATH, 'utf8');
            settings = JSON.parse(data);
        } catch (err) {
            // If file doesn't exist or is invalid, start with empty object
            console.warn('Settings file not found or invalid, creating new one.');
        }

        // Update bot name
        settings.botName = newBotName;

        // Write back to file
        await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));

        return sock.sendMessage(chatId, { 
            text: `✅ Bot name changed to: *${newBotName}* (stored in settings)` 
        }, { quoted: message });

    } catch (error) {
        console.error('Error in setBotNameCommand:', error);
        return sock.sendMessage(chatId, { 
            text: `❌ Error: ${error.message}` 
        }, { quoted: message }).catch(() => {});
    }
}

module.exports = setBotNameCommand;
