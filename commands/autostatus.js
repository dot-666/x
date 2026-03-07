const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

// Path to store auto status configuration
const configPath = path.join(__dirname, '../data/autoStatus.json');

// Default reaction emojis
const DEFAULT_EMOJIS = ['💚', '🔥', '✨', '😂', '👍', '🌟', '💯', '🥳', '😎', '🙌'];

// Initialize config file if it doesn't exist
if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ 
        enabled: false, 
        reactOn: false,
        reactionEmojis: DEFAULT_EMOJIS
    }));
}

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

        // Read current config
        let config = JSON.parse(fs.readFileSync(configPath));

        // If no arguments, show current status
        if (!args || args.length === 0) {
            const status = config.enabled ? 'ON' : 'OFF';
            const reactStatus = config.reactOn ? 'ON' : 'OFF';
            const emojis = config.reactionEmojis?.join(' ') || DEFAULT_EMOJIS.join(' ');
            await sock.sendMessage(chatId, { 
                text: `🔄 *Auto Status*\n📱 View: ${status}\n💫 React: ${reactStatus}\n😀 Emojis: ${emojis}\n\nCommands:\n.autostatus on/off\n.autostatus react on/off\n.autostatus emoji [set/add/remove/reset]`
            }, { quoted: msg });
            return;
        }

        // Handle commands
        const command = args[0].toLowerCase();
        
        if (command === 'on') {
            config.enabled = true;
            fs.writeFileSync(configPath, JSON.stringify(config));
            await sock.sendMessage(chatId, { 
                text: '✅ Auto status enabled!'
            }, { quoted: msg });
        } else if (command === 'off') {
            config.enabled = false;
            fs.writeFileSync(configPath, JSON.stringify(config));
            await sock.sendMessage(chatId, { 
                text: '❌ Auto status disabled!'
            }, { quoted: msg });
        } else if (command === 'react') {
            if (!args[1]) {
                await sock.sendMessage(chatId, { 
                    text: '❌ Use: .autostatus react on/off'
                }, { quoted: msg });
                return;
            }
            
            const reactCommand = args[1].toLowerCase();
            if (reactCommand === 'on') {
                config.reactOn = true;
                fs.writeFileSync(configPath, JSON.stringify(config));
                await sock.sendMessage(chatId, { 
                    text: '💫 Status reactions ON!'
                }, { quoted: msg });
            } else if (reactCommand === 'off') {
                config.reactOn = false;
                fs.writeFileSync(configPath, JSON.stringify(config));
                await sock.sendMessage(chatId, { 
                    text: '❌ Status reactions OFF!'
                }, { quoted: msg });
            } else {
                await sock.sendMessage(chatId, { 
                    text: '❌ Invalid! Use: .autostatus react on/off'
                }, { quoted: msg });
            }
        } else if (command === 'emoji') {
            // Emoji subcommands
            if (!args[1]) {
                // Show current emojis
                const emojis = config.reactionEmojis?.join(' ') || DEFAULT_EMOJIS.join(' ');
                await sock.sendMessage(chatId, { 
                    text: `😀 Current reaction emojis:\n${emojis}\n\nTo change:\n.autostatus emoji set 🥰 😍\n.autostatus emoji add 😎\n.autostatus emoji remove 😂\n.autostatus emoji reset`
                }, { quoted: msg });
                return;
            }

            const sub = args[1].toLowerCase();
            if (sub === 'set') {
                const newEmojis = args.slice(2).filter(e => e.trim() !== '');
                if (newEmojis.length === 0) {
                    await sock.sendMessage(chatId, { text: '❌ Provide at least one emoji.' }, { quoted: msg });
                    return;
                }
                config.reactionEmojis = newEmojis;
                fs.writeFileSync(configPath, JSON.stringify(config));
                await sock.sendMessage(chatId, { text: `✅ Reaction emojis set to: ${newEmojis.join(' ')}` }, { quoted: msg });
            } else if (sub === 'add') {
                const newEmoji = args[2];
                if (!newEmoji) {
                    await sock.sendMessage(chatId, { text: '❌ Provide an emoji to add.' }, { quoted: msg });
                    return;
                }
                if (!config.reactionEmojis) config.reactionEmojis = [];
                if (!config.reactionEmojis.includes(newEmoji)) {
                    config.reactionEmojis.push(newEmoji);
                    fs.writeFileSync(configPath, JSON.stringify(config));
                    await sock.sendMessage(chatId, { text: `✅ Added emoji: ${newEmoji}` }, { quoted: msg });
                } else {
                    await sock.sendMessage(chatId, { text: `⚠️ Emoji already exists.` }, { quoted: msg });
                }
            } else if (sub === 'remove') {
                const oldEmoji = args[2];
                if (!oldEmoji) {
                    await sock.sendMessage(chatId, { text: '❌ Provide an emoji to remove.' }, { quoted: msg });
                    return;
                }
                if (config.reactionEmojis && config.reactionEmojis.includes(oldEmoji)) {
                    config.reactionEmojis = config.reactionEmojis.filter(e => e !== oldEmoji);
                    fs.writeFileSync(configPath, JSON.stringify(config));
                    await sock.sendMessage(chatId, { text: `✅ Removed emoji: ${oldEmoji}` }, { quoted: msg });
                } else {
                    await sock.sendMessage(chatId, { text: `❌ Emoji not found.` }, { quoted: msg });
                }
            } else if (sub === 'reset') {
                config.reactionEmojis = DEFAULT_EMOJIS;
                fs.writeFileSync(configPath, JSON.stringify(config));
                await sock.sendMessage(chatId, { text: `✅ Reaction emojis reset to default.` }, { quoted: msg });
            } else {
                await sock.sendMessage(chatId, { text: '❌ Invalid emoji command. Use: set/add/remove/reset' }, { quoted: msg });
            }
        } else {
            await sock.sendMessage(chatId, { 
                text: '❌ Invalid! Use:\n.autostatus on/off\n.autostatus react on/off\n.autostatus emoji ...'
            }, { quoted: msg });
        }

    } catch (error) {
        console.error('Error in autostatus command:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Error: ' + error.message
        }, { quoted: msg });
    }
}

// Function to check if auto status is enabled
function isAutoStatusEnabled() {
    try {
        const config = JSON.parse(fs.readFileSync(configPath));
        return config.enabled;
    } catch (error) {
        console.error('Error checking auto status config:', error);
        return false;
    }
}

// Function to check if status reactions are enabled
function isStatusReactionEnabled() {
    try {
        const config = JSON.parse(fs.readFileSync(configPath));
        return config.reactOn;
    } catch (error) {
        console.error('Error checking status reaction config:', error);
        return false;
    }
}

// Get current reaction emoji list
function getReactionEmojis() {
    try {
        const config = JSON.parse(fs.readFileSync(configPath));
        return config.reactionEmojis && config.reactionEmojis.length ? config.reactionEmojis : DEFAULT_EMOJIS;
    } catch (error) {
        console.error('Error reading reaction emojis:', error);
        return DEFAULT_EMOJIS;
    }
}

// Function to react to status with random emoji
async function reactToStatus(sock, statusKey) {
    try {
        if (!isStatusReactionEnabled()) return;

        const emojis = getReactionEmojis();
        // If no emojis configured, fallback to default
        const finalEmojis = emojis.length ? emojis : DEFAULT_EMOJIS;
        const randomEmoji = finalEmojis[Math.floor(Math.random() * finalEmojis.length)];

        await sock.relayMessage(
            'status@broadcast',
            {
                reactionMessage: {
                    key: {
                        remoteJid: 'status@broadcast',
                        id: statusKey.id,
                        participant: statusKey.participant || statusKey.remoteJid,
                        fromMe: false
                    },
                    text: randomEmoji
                }
            },
            {
                messageId: statusKey.id,
                statusJidList: [statusKey.remoteJid, statusKey.participant || statusKey.remoteJid]
            }
        );
    } catch (error) {
        console.error('❌ Error reacting to status:', error.message);
    }
}

// Function to handle status updates
async function handleStatusUpdate(sock, status) {
    try {
        if (!isAutoStatusEnabled()) return;

        await new Promise(resolve => setTimeout(resolve, 1000));

        if (status.messages && status.messages.length > 0) {
            const msg = status.messages[0];
            if (msg.key && msg.key.remoteJid === 'status@broadcast') {
                try {
                    await sock.readMessages([msg.key]);
                    await reactToStatus(sock, msg.key);
                } catch (err) {
                    if (err.message?.includes('rate-overlimit')) {
                        console.log('⚠️ Rate limit, retrying...');
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        await sock.readMessages([msg.key]);
                    } else throw err;
                }
                return;
            }
        }

        if (status.key && status.key.remoteJid === 'status@broadcast') {
            try {
                await sock.readMessages([status.key]);
                await reactToStatus(sock, status.key);
            } catch (err) {
                if (err.message?.includes('rate-overlimit')) {
                    console.log('⚠️ Rate limit, retrying...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await sock.readMessages([status.key]);
                } else throw err;
            }
            return;
        }

        if (status.reaction && status.reaction.key.remoteJid === 'status@broadcast') {
            try {
                await sock.readMessages([status.reaction.key]);
                await reactToStatus(sock, status.reaction.key);
            } catch (err) {
                if (err.message?.includes('rate-overlimit')) {
                    console.log('⚠️ Rate limit, retrying...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await sock.readMessages([status.reaction.key]);
                } else throw err;
            }
            return;
        }

    } catch (error) {
        console.error('❌ Error in auto status view:', error.message);
    }
}

module.exports = {
    autoStatusCommand,
    handleStatusUpdate
};
