/**
 * June-X Bot
 * Autotyping Command - Shows fake typing status
 */

const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');
const { createFakeContact } = require('../lib/fakeContact');

const configPath = path.join(__dirname, '..', 'data', 'autotyping.json');

function initConfig() {
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify({ enabled: false }, null, 2));
    }
    return JSON.parse(fs.readFileSync(configPath));
}

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

        const args = message.message?.conversation?.trim().split(' ').slice(1) ||
            message.message?.extendedTextMessage?.text?.trim().split(' ').slice(1) ||
            [];

        const config = initConfig();

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
            config.enabled = !config.enabled;
        }

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

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

function isAutotypingEnabled() {
    try {
        return initConfig().enabled;
    } catch {
        return false;
    }
}

async function _sendTypingPresence(sock, chatId, durationMs) {
    try {
        await sock.presenceSubscribe(chatId);
        await sock.sendPresenceUpdate('available', chatId);
        await new Promise(r => setTimeout(r, 300));
        await sock.sendPresenceUpdate('composing', chatId);

        const refreshInterval = 4000;
        const cycles = Math.floor(durationMs / refreshInterval);

        for (let i = 0; i < cycles; i++) {
            await new Promise(r => setTimeout(r, refreshInterval));
            await sock.sendPresenceUpdate('composing', chatId);
        }

        const remaining = durationMs - cycles * refreshInterval;
        if (remaining > 0) {
            await new Promise(r => setTimeout(r, remaining));
        }

        await sock.sendPresenceUpdate('paused', chatId);
    } catch (err) {
        console.error('❌ Typing presence error:', err.message || err);
    }
}

function handleAutotypingForMessage(sock, chatId, userMessage) {
    if (!isAutotypingEnabled()) return;
    const duration = Math.max(4000, Math.min(12000, (userMessage?.length || 20) * 150));
    _sendTypingPresence(sock, chatId, duration);
}

function handleAutotypingForCommand(sock, chatId) {
    if (!isAutotypingEnabled()) return;
    _sendTypingPresence(sock, chatId, 6000);
}

function showTypingAfterCommand(sock, chatId) {
    if (!isAutotypingEnabled()) return;
    _sendTypingPresence(sock, chatId, 4000);
}

function straightTypingPresence(sock, chatId) {
    if (!isAutotypingEnabled()) return;
    _sendTypingPresence(sock, chatId, 8000);
}

module.exports = {
    autotypingCommand,
    isAutotypingEnabled,
    straightTypingPresence,
    handleAutotypingForMessage,
    handleAutotypingForCommand,
    showTypingAfterCommand
};
