const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

// Path to store auto status configuration
const configPath = path.join(__dirname, '../data/autoStatus.json');
const userSettingsPath = path.join(__dirname, '../data/userSettings.json');

// Initialize config files if they don't exist
if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ 
        enabled: false,
        autoView: true,
        autoLike: false,
        likeEmoji: '❤️'
    }));
}

if (!fs.existsSync(userSettingsPath)) {
    fs.writeFileSync(userSettingsPath, JSON.stringify({}));
}

// Helper to get user settings
function getUserSettings(userId) {
    try {
        const settings = JSON.parse(fs.readFileSync(userSettingsPath));
        return settings[userId] || {
            autoView: true,
            autoLike: false,
            likeEmoji: '❤️'
        };
    } catch {
        return {
            autoView: true,
            autoLike: false,
            likeEmoji: '❤️'
        };
    }
}

// Helper to save user settings
function saveUserSettings(userId, settings) {
    try {
        const allSettings = JSON.parse(fs.readFileSync(userSettingsPath));
        allSettings[userId] = settings;
        fs.writeFileSync(userSettingsPath, JSON.stringify(allSettings, null, 2));
    } catch (error) {
        console.error('Error saving user settings:', error);
    }
}

// Helper to get global setting (fallback)
function getGlobalSetting() {
    try {
        return JSON.parse(fs.readFileSync(configPath));
    } catch {
        return { enabled: false, autoView: true, autoLike: false, likeEmoji: '❤️' };
    }
}

// Main command function
async function autoStatusCommand(sock, chatId, msg, args) {
    try {
        const senderId = msg.key.participant || msg.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
        
        if (!msg.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, { 
                text: '❌ Only owner can use this!'
            }, { quoted: msg });
            return;
        }

        // Get current config
        const globalConfig = getGlobalSetting();
        const userSettings = getUserSettings(senderId);

        // If no arguments, show current status
        if (!args || args.length === 0) {
            const globalStatus = globalConfig.enabled ? 'ON' : 'OFF';
            const autoViewStatus = userSettings.autoView ? 'ON' : 'OFF';
            const autoLikeStatus = userSettings.autoLike ? 'ON' : 'OFF';
            const currentEmoji = userSettings.likeEmoji || '❤️';
            
            await sock.sendMessage(chatId, { 
                text: `🔄 *Auto Status Settings*\n` +
                      `━━━━━━━━━━━━━━\n` +
                      `📱 *Global Switch:* ${globalStatus}\n` +
                      `👁️ *Auto View:* ${autoViewStatus}\n` +
                      `💫 *Auto Like:* ${autoLikeStatus}\n` +
                      `😊 *Like Emoji:* ${currentEmoji}\n` +
                      `━━━━━━━━━━━━━━\n` +
                      `*Commands:*\n` +
                      `▸ .autostatus on/off - Global toggle\n` +
                      `▸ .autostatus view on/off - Toggle auto view\n` +
                      `▸ .autostatus like on/off - Toggle auto likes\n` +
                      `▸ .autostatus emoji [emoji] - Set like emoji\n` +
                      `▸ .autostatus status - Show current settings`
            }, { quoted: msg });
            return;
        }

        const command = args[0].toLowerCase();
        
        // Global on/off toggle
        if (command === 'on' || command === 'off') {
            globalConfig.enabled = (command === 'on');
            fs.writeFileSync(configPath, JSON.stringify(globalConfig, null, 2));
            
            await sock.sendMessage(chatId, { 
                text: `✅ Auto status ${command === 'on' ? 'enabled' : 'disabled'} globally!`
            }, { quoted: msg });
        }
        
        // Auto view toggle (per user)
        else if (command === 'view') {
            if (!args[1]) {
                await sock.sendMessage(chatId, { 
                    text: '❌ Use: .autostatus view on/off'
                }, { quoted: msg });
                return;
            }
            
            const viewCommand = args[1].toLowerCase();
            if (viewCommand === 'on' || viewCommand === 'off') {
                userSettings.autoView = (viewCommand === 'on');
                saveUserSettings(senderId, userSettings);
                
                await sock.sendMessage(chatId, { 
                    text: `👁️ Auto view ${viewCommand === 'on' ? 'enabled' : 'disabled'}!`
                }, { quoted: msg });
            } else {
                await sock.sendMessage(chatId, { 
                    text: '❌ Invalid! Use: .autostatus view on/off'
                }, { quoted: msg });
            }
        }
        
        // Auto like toggle (per user)
        else if (command === 'like') {
            if (!args[1]) {
                await sock.sendMessage(chatId, { 
                    text: '❌ Use: .autostatus like on/off'
                }, { quoted: msg });
                return;
            }
            
            const likeCommand = args[1].toLowerCase();
            if (likeCommand === 'on' || likeCommand === 'off') {
                userSettings.autoLike = (likeCommand === 'on');
                saveUserSettings(senderId, userSettings);
                
                await sock.sendMessage(chatId, { 
                    text: `💫 Auto like ${likeCommand === 'on' ? 'enabled' : 'disabled'}!`
                }, { quoted: msg });
            } else {
                await sock.sendMessage(chatId, { 
                    text: '❌ Invalid! Use: .autostatus like on/off'
                }, { quoted: msg });
            }
        }
        
        // Set like emoji
        else if (command === 'emoji') {
            if (!args[1]) {
                await sock.sendMessage(chatId, { 
                    text: '❌ Use: .autostatus emoji [emoji]\nExample: .autostatus emoji ❤️'
                }, { quoted: msg });
                return;
            }
            
            const newEmoji = args[1];
            // Simple validation - check if it's a single emoji (can be improved)
            if (newEmoji.length > 2) {
                await sock.sendMessage(chatId, { 
                    text: '❌ Please provide a single emoji!'
                }, { quoted: msg });
                return;
            }
            
            userSettings.likeEmoji = newEmoji;
            saveUserSettings(senderId, userSettings);
            
            await sock.sendMessage(chatId, { 
                text: `😊 Like emoji set to: ${newEmoji}`
            }, { quoted: msg });
        }
        
        // Show status
        else if (command === 'status') {
            const globalStatus = globalConfig.enabled ? 'ON' : 'OFF';
            const autoViewStatus = userSettings.autoView ? 'ON' : 'OFF';
            const autoLikeStatus = userSettings.autoLike ? 'ON' : 'OFF';
            const currentEmoji = userSettings.likeEmoji || '❤️';
            
            await sock.sendMessage(chatId, { 
                text: `📊 *Current Auto Status Settings*\n` +
                      `━━━━━━━━━━━━━━\n` +
                      `🌐 *Global:* ${globalStatus}\n` +
                      `👁️ *View:* ${autoViewStatus}\n` +
                      `💫 *Like:* ${autoLikeStatus}\n` +
                      `😊 *Emoji:* ${currentEmoji}\n` +
                      `━━━━━━━━━━━━━━`
            }, { quoted: msg });
        }
        
        else {
            await sock.sendMessage(chatId, { 
                text: '❌ Invalid command! Use:\n' +
                      '▸ .autostatus on/off\n' +
                      '▸ .autostatus view on/off\n' +
                      '▸ .autostatus like on/off\n' +
                      '▸ .autostatus emoji [emoji]\n' +
                      '▸ .autostatus status'
            }, { quoted: msg });
        }

    } catch (error) {
        console.error('Error in autostatus command:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Error: ' + error.message
        }, { quoted: msg });
    }
}

// Function to check if auto status is enabled (global)
function isAutoStatusEnabled() {
    try {
        const config = JSON.parse(fs.readFileSync(configPath));
        return config.enabled;
    } catch {
        return false;
    }
}

// Function to get user-specific settings
function getUserStatusSettings(userId) {
    return getUserSettings(userId);
}

module.exports = {
    autoStatusCommand,
    isAutoStatusEnabled,
    getUserStatusSettings
};
