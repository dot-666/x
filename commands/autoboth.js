/**
 * June-X Bot
 * Autoboth Command - Shows both fake typing and recording alternating
 */

const fs = require('fs');
const path = require('path');
const { isSudo } = require('../lib/index');
const { createFakeContact } = require('../lib/fakeContact');

const configPath = path.join(__dirname, '..', 'data', 'autoboth.json');

function initConfig() {
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify({ enabled: false }, null, 2));
    }
    return JSON.parse(fs.readFileSync(configPath));
}

async function autobothCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        if (!message.key.fromMe && !(await isSudo(senderId))) {
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
                    text: '❌ Invalid option! Use: .autoboth on/off'
                }, { quoted: createFakeContact(message) });
                return;
            }
        } else {
            config.enabled = !config.enabled;
        }

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        await sock.sendMessage(chatId, {
            text: `✅ Auto-both (typing + recording) has been ${config.enabled ? 'enabled' : 'disabled'}!\n${config.enabled ? '⌨️🎙️ Will show typing and recording alternating on every message.' : ''}`
        }, { quoted: createFakeContact(message) });

    } catch (error) {
        console.error('Error in autoboth command:', error);
        await sock.sendMessage(chatId, {
            text: '❌ Error processing command!'
        }, { quoted: createFakeContact(message) });
    }
}

function isAutobothEnabled() {
    try {
        return initConfig().enabled;
    } catch {
        return false;
    }
}

async function _sendBothPresence(sock, chatId, durationMs) {
    try {
        await sock.presenceSubscribe(chatId);
        await sock.sendPresenceUpdate('available', chatId);
        await new Promise(r => setTimeout(r, 300));

        const switchInterval = 3000;
        const totalCycles = Math.floor(durationMs / switchInterval);
        let useTyping = true;

        for (let i = 0; i < totalCycles; i++) {
            await sock.sendPresenceUpdate(useTyping ? 'composing' : 'recording', chatId);
            await new Promise(r => setTimeout(r, switchInterval));
            useTyping = !useTyping;
        }

        const remaining = durationMs - totalCycles * switchInterval;
        if (remaining > 0) {
            await sock.sendPresenceUpdate(useTyping ? 'composing' : 'recording', chatId);
            await new Promise(r => setTimeout(r, remaining));
        }

        await sock.sendPresenceUpdate('paused', chatId);
    } catch (err) {
        console.error('❌ Autoboth presence error:', err.message || err);
    }
}

function handleAutobothForMessage(sock, chatId, userMessage) {
    if (!isAutobothEnabled()) return;
    const duration = Math.max(6000, Math.min(15000, (userMessage?.length || 20) * 150));
    _sendBothPresence(sock, chatId, duration);
}

function handleAutobothForCommand(sock, chatId) {
    if (!isAutobothEnabled()) return;
    _sendBothPresence(sock, chatId, 9000);
}

function straightBothPresence(sock, chatId) {
    if (!isAutobothEnabled()) return;
    _sendBothPresence(sock, chatId, 9000);
}

module.exports = {
    autobothCommand,
    isAutobothEnabled,
    straightBothPresence,
    handleAutobothForMessage,
    handleAutobothForCommand
};
