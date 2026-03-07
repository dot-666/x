const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

// Path to store auto status configuration
const configPath = path.join(__dirname, '../data/autoStatus.json');

// Initialize config file if it doesn't exist
if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ 
        enabled: false, 
        reactOn: false 
    }));
}

// === Owner Command Handler ===
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

        let config = JSON.parse(fs.readFileSync(configPath));

        if (!args || args.length === 0) {
            const status = config.enabled ? 'ON' : 'OFF';
            const reactStatus = config.reactOn ? 'ON' : 'OFF';
            await sock.sendMessage(chatId, { 
                text: `🔄 *Auto Status*\n📱 View: ${status}\n💫 React: ${reactStatus}\n\nCommands:\n.autostatus on/off\n.autostatus react on/off`
            }, { quoted: msg });
            return;
        }

        const command = args[0].toLowerCase();
        
        if (command === 'on') {
            config.enabled = true;
            fs.writeFileSync(configPath, JSON.stringify(config));
            await sock.sendMessage(chatId, { text: '✅ Auto status enabled!' }, { quoted: msg });
        } else if (command === 'off') {
            config.enabled = false;
            fs.writeFileSync(configPath, JSON.stringify(config));
            await sock.sendMessage(chatId, { text: '❌ Auto status disabled!' }, { quoted: msg });
        } else if (command === 'react') {
            if (!args[1]) {
                await sock.sendMessage(chatId, { text: '❌ Use: .autostatus react on/off' }, { quoted: msg });
                return;
            }
            const reactCommand = args[1].toLowerCase();
            if (reactCommand === 'on') {
                config.reactOn = true;
                fs.writeFileSync(configPath, JSON.stringify(config));
                await sock.sendMessage(chatId, { text: '💫 Status reactions ON!' }, { quoted: msg });
            } else if (reactCommand === 'off') {
                config.reactOn = false;
                fs.writeFileSync(configPath, JSON.stringify(config));
                await sock.sendMessage(chatId, { text: '❌ Status reactions OFF!' }, { quoted: msg });
            } else {
                await sock.sendMessage(chatId, { text: '❌ Invalid! Use: .autostatus react on/off' }, { quoted: msg });
            }
        } else {
            await sock.sendMessage(chatId, { 
                text: '❌ Invalid! Use:\n.autostatus on/off\n.autostatus react on/off'
            }, { quoted: msg });
        }

    } catch (error) {
        console.error('Error in autostatus command:', error);
        await sock.sendMessage(chatId, { text: '❌ Error: ' + error.message }, { quoted: msg });
    }
}

// === Config Helpers ===
function isAutoStatusEnabled() {
    try {
        const config = JSON.parse(fs.readFileSync(configPath));
        return config.enabled;
    } catch (error) {
        console.error('Error checking auto status config:', error);
        return false;
    }
}

function isStatusReactionEnabled() {
    try {
        const config = JSON.parse(fs.readFileSync(configPath));
        return config.reactOn;
    } catch (error) {
        console.error('Error checking status reaction config:', error);
        return false;
    }
}

// === New LID-aware Handler ===
async function handleBroadcastStatus(sock, mek, sessionKey, getSetting) {
    try {
        if (mek.key && mek.key.remoteJid === 'status@broadcast') {
            const autoView = getSetting(sessionKey, 'autoView', isAutoStatusEnabled());
            const autoLike = getSetting(sessionKey, 'autoLike', isStatusReactionEnabled());
            const likeEmoji = getSetting(sessionKey, 'likeEmoji', '❤️');

            const rawParticipant = mek.key.participant || mek.participant || '';
            let phoneJid = rawParticipant;

            // Resolve LID → phone JID
            if (rawParticipant.endsWith('@lid')) {
                try {
                    const pn = await sock.signalRepository?.lidMapping?.getPNForLID(rawParticipant);
                    if (pn) phoneJid = pn;
                } catch (_) {}
            }

            // Auto view
            if (autoView && phoneJid && !phoneJid.endsWith('@lid')) {
                const readKey = phoneJid !== rawParticipant
                    ? { ...mek.key, participant: phoneJid }
                    : mek.key;
                try { await sock.readMessages([readKey]); } catch (_) {}
            }

            // Auto like
            if (autoLike && phoneJid && !phoneJid.endsWith('@lid')) {
                const reactKey = { ...mek.key, participant: phoneJid };
                try {
                    await sock.sendMessage(
                        'status@broadcast',
                        { react: { text: likeEmoji, key: reactKey } },
                        { statusJidList: [phoneJid] }
                    );
                } catch (_) {}
            }
        }
    } catch (statusErr) {
        // Silent — never crash on status
    }
}

// === Unified Status Update Entry Point ===
async function handleStatusUpdate(sock, status, sessionKey, getSetting) {
    try {
        await handleBroadcastStatus(sock, status, sessionKey, getSetting);
    } catch (error) {
        console.error('❌ Error in auto status view:', error.message);
    }
}

module.exports = {
    autoStatusCommand,
    handleStatusUpdate
};
