const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone");
const { isSudo } = require("../lib/index"); // Import isSudo from lib

const readmore = "\n".repeat(4001);

// Path to data directory
const dataDir = path.join(__dirname, "..", "data");
const antieditFile = path.join(dataDir, "antiedit.json");

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize antiedit file if it doesn't exist
if (!fs.existsSync(antieditFile)) {
    fs.writeFileSync(antieditFile, JSON.stringify({
        settings: {},
        messages: {}
    }, null, 2));
}

// Helper function to read antiedit data
function readAntieditData() {
    try {
        const data = fs.readFileSync(antieditFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error("Error reading antiedit.json:", error);
        return { settings: {}, messages: {} };
    }
}

// Helper function to write antiedit data
function writeAntieditData(data) {
    const tempFile = antieditFile + '.tmp';
    try {
        fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
        fs.renameSync(tempFile, antieditFile);
    } catch (error) {
        console.error("Error writing to antiedit.json:", error);
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
}

// Function to store messages
function storeMessage(chatId, message) {
    try {
        // Don't store protocol messages (edits, etc.)
        if (message.message?.protocolMessage) return;

        const data = readAntieditData();
        
        if (!data.messages[chatId]) {
            data.messages[chatId] = {};
        }
        
        if (message.key?.id) {
            // Extract sender correctly
            const sender = message.key.participant || message.key.remoteJid || message.sender;
            
            data.messages[chatId][message.key.id] = {
                key: message.key,
                message: message.message,
                messageTimestamp: message.messageTimestamp,
                pushName: message.pushName,
                sender: sender,
                timestamp: Date.now()
            };
            
            // Clean old messages (keep last 100 per chat)
            const messageIds = Object.keys(data.messages[chatId]);
            if (messageIds.length > 100) {
                const oldestId = messageIds.sort((a, b) => 
                    data.messages[chatId][a].timestamp - data.messages[chatId][b].timestamp
                )[0];
                delete data.messages[chatId][oldestId];
            }
            
            writeAntieditData(data);
        }
    } catch (error) {
        console.error("Error storing message:", error);
    }
}

// Function to get anti-edit setting for a bot/user
function getAntieditSetting(botNumber) {
    try {
        const data = readAntieditData();
        return data.settings[botNumber] || 'off'; // Default to 'off'
    } catch (error) {
        console.error("Error getting anti-edit setting:", error);
        return 'off';
    }
}

// Function to set anti-edit setting
function setAntieditSetting(botNumber, mode) {
    try {
        const data = readAntieditData();
        data.settings[botNumber] = mode;
        writeAntieditData(data);
        return true;
    } catch (error) {
        console.error("Error setting anti-edit setting:", error);
        return false;
    }
}

// Main anti-edit command function
async function antieditCommand(sock, chatId, message) {
    try {
        // Check if this is an edited message
        if (!message.message?.protocolMessage?.editedMessage) {
            return;
        }

        // Get bot number
        const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        
        // Get anti-edit setting
        const antieditSetting = getAntieditSetting(botNumber);
        
        if (antieditSetting === 'off') {
            return;
        }

        // Extract message details
        let messageId = message.message.protocolMessage.key.id;
        let editedBy = message.key.participant || message.key.remoteJid || message.sender;

        // Ignore if the bot edited its own message
        if (editedBy === botNumber) return;

        // Get original message from store
        const data = readAntieditData();
        let originalMsg = data.messages[chatId]?.[messageId];

        if (!originalMsg) {
            console.log("⚠️ Original message not found in antiedit.json store.");
            return;
        }

        let sender = originalMsg.sender;
        
        // Get chat name
        let chatName;
        if (chatId.endsWith("@g.us")) {
            try {
                const groupInfo = await sock.groupMetadata(chatId);
                chatName = groupInfo.subject || "Group Chat";
            } catch {
                chatName = "Group Chat";
            }
        } else {
            chatName = originalMsg.pushName || "Private Chat";
        }

        // Use timezone from settings or default
        const timezone = "Asia/Jakarta"; // Could be made configurable

        // Format timestamps
        let xtipes = moment(originalMsg.messageTimestamp * 1000).tz(timezone).locale('en').format('HH:mm z');
        let xdptes = moment(originalMsg.messageTimestamp * 1000).tz(timezone).format("DD/MM/YYYY");

        // Get original text
        let originalText = originalMsg.message?.conversation || 
                          originalMsg.message?.extendedTextMessage?.text ||
                          originalMsg.message?.imageMessage?.caption ||
                          originalMsg.message?.videoMessage?.caption ||
                          "[Media message]";

        // Get edited text
        let editedText = message.message.protocolMessage?.editedMessage?.conversation || 
                        message.message.protocolMessage?.editedMessage?.extendedTextMessage?.text ||
                        "[Edit content not available]";

        // Prepare reply message
        let replyText = `🔮 *𝙴𝙳𝙸𝚃𝙴𝙳 𝙼𝙴𝚂𝚂𝙰𝙶𝙴!* 🔮
${readmore}
• 𝙲𝙷𝙰𝚃: ${chatName}
• 𝚂𝙴𝙽𝚃 𝙱𝚈: @${sender.split('@')[0]} 
• 𝚃𝙸𝙼𝙴: ${xtipes}
• 𝙳𝙰𝚃𝙴: ${xdptes}
• 𝙴𝙳𝙸𝚃𝙴𝙳 𝙱𝚈: @${editedBy.split('@')[0]}

• 𝙾𝚁𝙸𝙶𝙸𝙽𝙰𝙻: ${originalText}

• 𝙴𝙳𝙸𝚃𝙴𝙳 𝚃𝙾: ${editedText}`;

        // Prepare quoted message for context
        let quotedMessage = {
            key: {
                remoteJid: chatId,
                fromMe: sender === botNumber,
                id: messageId,
                participant: sender
            },
            message: {
                conversation: originalText.substring(0, 100) // Truncate if too long
            }
        };

        // Determine target based on mode
        let targetChat;
        if (antieditSetting === 'private') {
            // Get owner number from sudo list (first sudo user)
            // You might want to store this separately; for now we'll use the first sudo user
            // This requires access to sudo list; you could pass it or define globally
            // For simplicity, we'll use a config or environment variable
            const ownerNumber = process.env.OWNER_NUMBER || "1234567890@s.whatsapp.net"; // Replace with your owner
            targetChat = ownerNumber;
            console.log(`📤 Anti-edit: Sending to owner's inbox`);
        } else if (antieditSetting === 'chat') {
            targetChat = chatId; // Send to same chat
            console.log(`📤 Anti-edit: Sending to same chat`);
        } else {
            console.log("❌ Invalid anti-edit mode");
            return;
        }

        // Send the notification
        await sock.sendMessage(targetChat, { 
            text: replyText, 
            mentions: [sender, editedBy] 
        }, { quoted: quotedMessage });

    } catch (error) {
        console.error("❌ Anti-edit error:", error);
        // Only notify in the chat if we're sending there and it's a critical error
        if (chatId && antieditSetting === 'chat') {
            try {
                await sock.sendMessage(chatId, {
                    text: `⚠️ Anti-edit error: ${error.message}`
                });
            } catch (e) {}
        }
    }
}

// Command to set anti-edit setting (sudo only)
async function setAntiEdit(sock, chatId, message, userJid) {
    try {
        // Check if user is sudo (owner/authorized) or the message is from the bot itself
        if (!message.key.fromMe && !isSudo(userJid)) {
            await sock.sendMessage(chatId, { 
                text: "❌ Only sudo users can change anti-edit settings." 
            }, { quoted: message });
            return;
        }

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        const args = text?.split(" ").slice(1);
        const option = args[0]?.toLowerCase();

        // Get bot number
        const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        if (option === 'on' || option === 'chat') {
            setAntieditSetting(botNumber, 'chat');
            await sock.sendMessage(chatId, { 
                text: "✅ Anti-edit enabled! Edited messages will be shown in this chat." 
            }, { quoted: message });
        } else if (option === 'private') {
            setAntieditSetting(botNumber, 'private');
            await sock.sendMessage(chatId, { 
                text: "✅ Anti-edit enabled! Edited messages will be sent to owner's private chat." 
            }, { quoted: message });
        } else if (option === 'off') {
            setAntieditSetting(botNumber, 'off');
            await sock.sendMessage(chatId, { 
                text: "❌ Anti-edit disabled!" 
            }, { quoted: message });
        } else {
            // Show current setting
            const currentSetting = getAntieditSetting(botNumber);
            await sock.sendMessage(chatId, { 
                text: `📝 *Anti-Edit Settings*\n\nCurrent: ${currentSetting}\n\nUsage: .antiedit [on/chat/private/off]\n\n• on/chat: Show edits in this chat\n• private: Send edits to owner\n• off: Disable anti-edit` 
            }, { quoted: message });
        }
    } catch (error) {
        console.error("Set anti-edit error:", error);
        await sock.sendMessage(chatId, { 
            text: `🚫 Error: ${error.message}` 
        }, { quoted: message });
    }
}

// Function to view stored messages (sudo only)
async function viewAntieditStats(sock, chatId, message, userJid) {
    try {
        if (!message.key.fromMe && !isSudo(userJid)) {
            await sock.sendMessage(chatId, { 
                text: "❌ Only sudo users can view anti-edit stats." 
            }, { quoted: message });
            return;
        }

        const data = readAntieditData();
        const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        const currentSetting = data.settings[botNumber] || 'off';
        
        let totalMessages = 0;
        for (const chat in data.messages) {
            totalMessages += Object.keys(data.messages[chat]).length;
        }
        
        const stats = `📊 *Anti-Edit Statistics*\n\n` +
                     `• Current Setting: ${currentSetting}\n` +
                     `• Stored Chats: ${Object.keys(data.messages).length}\n` +
                     `• Total Messages: ${totalMessages}\n` +
                     `• Data File: ${antieditFile}`;
        
        await sock.sendMessage(chatId, { text: stats }, { quoted: message });
    } catch (error) {
        console.error("Stats error:", error);
        await sock.sendMessage(chatId, { 
            text: `🚫 Error: ${error.message}` 
        }, { quoted: message });
    }
}

module.exports = { 
    antieditCommand,
    storeMessage,
    setAntiEdit,
    viewAntieditStats
};
