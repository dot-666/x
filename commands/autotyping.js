/**
 * Knight Bot - A WhatsApp Bot
 * Autotyping Command - Shows fake typing status
 */

const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

// Path to store the configuration
const configPath = path.join(__dirname, '..', 'data', 'autotyping.json');

// Initialize configuration file if it doesn't exist
const { createFakeContact } = require('../lib/fakeContact');
function initConfig() {
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify({ enabled: false }, null, 2));
    }
    return JSON.parse(fs.readFileSync(configPath));
}

// Toggle autotyping feature
async function autotypingCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
        
        if (!message.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, {
                text: '❌ This command is only available for the owner!'
            }, { quoted: createFakeContact(message) });
            return;
        }

        // Get command arguments
        const args = message.message?.conversation?.trim().split(' ').slice(1) || 
                    message.message?.extendedTextMessage?.text?.trim().split(' ').slice(1) || 
                    [];
        
        // Initialize or read config
        const config = initConfig();
        
        // Toggle based on argument or toggle current state if no argument
        if (args.length > 0) {
            const action = args[0].toLowerCase();
            if (action === 'on' || action === 'enable') {
                config.enabled = true;
            } else if (action === 'off' || action === 'disable') {
                config.enabled = false;
            } else {
                await sock.sendMessage(chatId, {
                    text: '❌ Invalid option! Use: .autotyping on/off'
                }, { quoted: createFakeContact(message) });
                return;
            }
        } else {
            // Toggle current state
            config.enabled = !config.enabled;
        }
        
        // Save updated configuration
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        
        // Send confirmation message
        await sock.sendMessage(chatId, {
            text: `✅ Auto-typing has been ${config.enabled ? 'enabled' : 'disabled'}!`
        }, { quoted: createFakeContact(message) });
        
    } catch (error) {
        console.error('Error in autotyping command:', error);
        await sock.sendMessage(chatId, {
            text: '❌ Error processing command!'
        }, { quoted: createFakeContact(message) });
    }
}

// Function to check if autotyping is enabled
function isAutotypingEnabled() {
    try {
        const config = initConfig();
        return config.enabled;
    } catch (error) {
        console.error('Error checking autotyping status:', error);
        return false;
    }
}

// Function to handle autotyping for regular messages
async function handleAutotypingForMessage(sock, chatId, userMessage) {
    if (isAutotypingEnabled()) {
        try {
            // First subscribe to presence updates for this chat
            await sock.presenceSubscribe(chatId);
            
            // Send available status first
            await sock.sendPresenceUpdate('available', chatId);
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Then send the composing status
            await sock.sendPresenceUpdate('composing', chatId);
            
            // Simulate typing time based on message length with longer duration
            // Increased minimum and maximum times for more realistic typing
            const typingDelay = Math.max(5000, Math.min(15000, userMessage.length * 200));
            
            // Break the typing into multiple intervals to keep it active
            const intervals = Math.floor(typingDelay / 3000); // Refresh every 3 seconds
            
            for (let i = 0; i < intervals; i++) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                await sock.sendPresenceUpdate('composing', chatId);
            }
            
            // Additional delay for remaining time
            const remainingTime = typingDelay - (intervals * 3000);
            if (remainingTime > 0) {
                await new Promise(resolve => setTimeout(resolve, remainingTime));
                await sock.sendPresenceUpdate('composing', chatId);
            }
            
            // Finally send paused status
            await sock.sendPresenceUpdate('paused', chatId);
            
            return true; // Indicates typing was shown
        } catch (error) {
            console.error('❌ Error sending typing indicator:', error);
            return false; // Indicates typing failed
        }
    }
    return false; // Autotyping is disabled
}

// Function to handle autotyping for commands - BEFORE command execution
async function handleAutotypingForCommand(sock, chatId) {
    if (isAutotypingEnabled()) {
        try {
            // First subscribe to presence updates for this chat
            await sock.presenceSubscribe(chatId);
            
            // Send available status first
            await sock.sendPresenceUpdate('available', chatId);
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Then send the composing status
            await sock.sendPresenceUpdate('composing', chatId);
            
            // Keep typing indicator active for commands with longer duration
            const commandTypingDelay = 8000; // Increased to 8 seconds
            
            // Break into intervals to keep it active
            const intervals = Math.floor(commandTypingDelay / 3000);
            
            for (let i = 0; i < intervals; i++) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                await sock.sendPresenceUpdate('composing', chatId);
            }
            
            // Additional delay for remaining time
            const remainingTime = commandTypingDelay - (intervals * 3000);
            if (remainingTime > 0) {
                await new Promise(resolve => setTimeout(resolve, remainingTime));
                await sock.sendPresenceUpdate('composing', chatId);
            }
            
            // Finally send paused status
            await sock.sendPresenceUpdate('paused', chatId);
            
            return true; // Indicates typing was shown
        } catch (error) {
            console.error('❌ Error sending command typing indicator:', error);
            return false; // Indicates typing failed
        }
    }
    return false; // Autotyping is disabled
}

// Function to show typing status AFTER command execution
async function showTypingAfterCommand(sock, chatId) {
    if (isAutotypingEnabled()) {
        try {
            // This function runs after the command has been executed and response sent
            // So we show a longer typing indicator for better UX
            
            // Subscribe to presence updates
            await sock.presenceSubscribe(chatId);
            
            // Show typing status for a longer duration
            const postCommandDelay = 5000; // 5 seconds
            
            await sock.sendPresenceUpdate('composing', chatId);
            
            // Break into intervals to keep it active
            const intervals = Math.floor(postCommandDelay / 3000);
            
            for (let i = 0; i < intervals; i++) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                await sock.sendPresenceUpdate('composing', chatId);
            }
            
            // Additional delay for remaining time
            const remainingTime = postCommandDelay - (intervals * 3000);
            if (remainingTime > 0) {
                await new Promise(resolve => setTimeout(resolve, remainingTime));
                await sock.sendPresenceUpdate('composing', chatId);
            }
            
            // Then pause
            await sock.sendPresenceUpdate('paused', chatId);
            
            return true;
        } catch (error) {
            console.error('❌ Error sending post-command typing indicator:', error);
            return false;
        }
    }
    return false; // Autotyping is disabled
}

module.exports = {
    autotypingCommand,
    isAutotypingEnabled,
    handleAutotypingForMessage,
    handleAutotypingForCommand,
    showTypingAfterCommand
};
