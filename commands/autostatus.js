const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

// Path to store auto status configuration
const configPath = path.join(__dirname, '../data/autoStatus.json');

// Cache for resolved LIDs to avoid repeated resolution
const lidCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Initialize config file if it doesn't exist
if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ 
        enabled: false, 
        reactOn: false,
        reactEmoji: '💚', // Default emoji
        randomReact: true // Random emoji by default
    }));
}

// Function to resolve LID from JID
async function resolveLid(sock, jid) {
    try {
        // Check cache first
        if (lidCache.has(jid)) {
            const cached = lidCache.get(jid);
            if (Date.now() - cached.timestamp < CACHE_TTL) {
                return cached.lid;
            }
            lidCache.delete(jid);
        }

        // Try to resolve LID using different methods
        
        // Method 1: Try to get from profile
        const [result] = await sock.onWhatsApp(jid);
        if (result?.lid) {
            const lid = result.lid;
            lidCache.set(jid, { lid, timestamp: Date.now() });
            return lid;
        }

        // Method 2: Try to get from contact
        const contact = await sock.contacts[jid];
        if (contact?.lid) {
            lidCache.set(jid, { lid: contact.lid, timestamp: Date.now() });
            return contact.lid;
        }

        // Method 3: For status broadcasts, use a different approach
        if (jid.includes('status')) {
            // Extract phone number from JID
            const phoneNumber = jid.split('@')[0];
            // Some implementations use lid format with phone number
            const lid = `${phoneNumber}@lid`; // Adjust format as needed
            lidCache.set(jid, { lid, timestamp: Date.now() });
            return lid;
        }

        return null;
    } catch (error) {
        console.error('❌ Error resolving LID:', error.message);
        return null;
    }
}

// Function to react using LID
async function reactWithLid(sock, statusKey, emoji) {
    try {
        // Resolve LID for the status sender
        const senderJid = statusKey.participant || statusKey.remoteJid;
        const lid = await resolveLid(sock, senderJid);
        
        if (!lid) {
            console.log('⚠️ Could not resolve LID, falling back to standard reaction');
            return await reactToStatus(sock, statusKey, emoji);
        }

        // Create reaction with LID
        const reactionMessage = {
            react: {
                key: statusKey,
                text: emoji,
                timestamp: Date.now(),
                // LID-specific fields
                senderLid: lid,
                participantLid: lid
            }
        };

        // Send reaction with LID optimization
        await sock.sendMessage('status@broadcast', reactionMessage, {
            statusJidList: [senderJid, lid],
            additionalNodes: [
                {
                    tag: 'react',
                    attrs: {
                        lid: lid,
                        jid: senderJid
                    }
                }
            ]
        });

        console.log(`✅ Reacted with ${emoji} using LID: ${lid}`);
    } catch (error) {
        console.error('❌ Error reacting with LID:', error.message);
        // Fallback to standard reaction
        await reactToStatus(sock, statusKey, emoji);
    }
}

// Updated reaction function with LID support
async function reactToStatus(sock, statusKey, customEmoji = null) {
    try {
        if (!isStatusReactionEnabled()) return;

        // Read config for reaction settings
        const config = JSON.parse(fs.readFileSync(configPath));
        
        let emoji = customEmoji;
        
        // If no custom emoji, determine which emoji to use
        if (!emoji) {
            if (config.randomReact) {
                // Define emoji pool
                const emojis = ['💚', '🔥', '✨', '😂', '👍', '🌟', '💯', '🥳', '😎', '🙌', '❤️', '👏', '🎉', '🤣', '😍'];
                emoji = emojis[Math.floor(Math.random() * emojis.length)];
            } else {
                emoji = config.reactEmoji || '💚';
            }
        }

        // Try LID-based reaction first for efficiency
        await reactWithLid(sock, statusKey, emoji);

    } catch (error) {
        console.error('❌ Error in reactToStatus:', error.message);
        // Fallback to basic reaction
        try {
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
                        text: emoji || '💚'
                    }
                },
                {
                    messageId: statusKey.id,
                    statusJidList: [statusKey.remoteJid, statusKey.participant || statusKey.remoteJid]
                }
            );
        } catch (fallbackError) {
            console.error('❌ Fallback reaction also failed:', fallbackError.message);
        }
    }
}

// Function to preload LIDs for contacts
async function preloadContactLids(sock) {
    try {
        console.log('🔄 Preloading contact LIDs...');
        const contacts = await sock.contacts || {};
        
        for (const [jid, contact] of Object.entries(contacts)) {
            if (contact.lid) {
                lidCache.set(jid, { lid: contact.lid, timestamp: Date.now() });
            }
        }
        
        console.log(`✅ Preloaded ${lidCache.size} LIDs`);
    } catch (error) {
        console.error('❌ Error preloading LIDs:', error.message);
    }
}

// Updated autoStatusCommand with LID features
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
            const randomStatus = config.randomReact ? 'ON' : 'OFF';
            await sock.sendMessage(chatId, { 
                text: `🔄 *Auto Status (LID Enhanced)*\n📱 View: ${status}\n💫 React: ${reactStatus}\n🎲 Random: ${randomStatus}\n😊 Default Emoji: ${config.reactEmoji}\n📇 Cached LIDs: ${lidCache.size}\n\n*Commands:*\n.autostatus on/off\n.autostatus react on/off\n.autostatus random on/off\n.autostatus emoji [emoji]\n.autostatus cache clear\n.autostatus preload`
            }, { quoted: msg });
            return;
        }

        // Handle commands
        const command = args[0].toLowerCase();
        
        if (command === 'on') {
            config.enabled = true;
            fs.writeFileSync(configPath, JSON.stringify(config));
            await sock.sendMessage(chatId, { 
                text: '✅ Auto status enabled (LID optimized)!'
            }, { quoted: msg });
        } 
        else if (command === 'off') {
            config.enabled = false;
            fs.writeFileSync(configPath, JSON.stringify(config));
            await sock.sendMessage(chatId, { 
                text: '❌ Auto status disabled!'
            }, { quoted: msg });
        } 
        else if (command === 'react') {
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
                    text: '💫 Status reactions ON (LID enabled)!'
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
        }
        else if (command === 'random') {
            if (!args[1]) {
                await sock.sendMessage(chatId, { 
                    text: '❌ Use: .autostatus random on/off'
                }, { quoted: msg });
                return;
            }
            
            const randomCommand = args[1].toLowerCase();
            if (randomCommand === 'on') {
                config.randomReact = true;
                fs.writeFileSync(configPath, JSON.stringify(config));
                await sock.sendMessage(chatId, { 
                    text: '🎲 Random reactions ON!'
                }, { quoted: msg });
            } else if (randomCommand === 'off') {
                config.randomReact = false;
                fs.writeFileSync(configPath, JSON.stringify(config));
                await sock.sendMessage(chatId, { 
                    text: '❌ Random reactions OFF!'
                }, { quoted: msg });
            } else {
                await sock.sendMessage(chatId, { 
                    text: '❌ Invalid! Use: .autostatus random on/off'
                }, { quoted: msg });
            }
        }
        else if (command === 'emoji') {
            if (!args[1]) {
                await sock.sendMessage(chatId, { 
                    text: `❌ Use: .autostatus emoji [emoji]\nCurrent: ${config.reactEmoji}`
                }, { quoted: msg });
                return;
            }
            
            config.reactEmoji = args[1];
            config.randomReact = false; // Turn off random when custom emoji set
            fs.writeFileSync(configPath, JSON.stringify(config));
            await sock.sendMessage(chatId, { 
                text: `✅ Default reaction emoji set to: ${args[1]}`
            }, { quoted: msg });
        }
        else if (command === 'cache') {
            if (args[1] === 'clear') {
                lidCache.clear();
                await sock.sendMessage(chatId, { 
                    text: '✅ LID cache cleared!'
                }, { quoted: msg });
            } else {
                await sock.sendMessage(chatId, { 
                    text: `📇 LID Cache: ${lidCache.size} entries\nUse .autostatus cache clear to reset`
                }, { quoted: msg });
            }
        }
        else if (command === 'preload') {
            await sock.sendMessage(chatId, { 
                text: '🔄 Preloading contact LIDs...'
            }, { quoted: msg });
            
            await preloadContactLids(sock);
            
            await sock.sendMessage(chatId, { 
                text: `✅ Preloaded ${lidCache.size} LIDs!`
            }, { quoted: msg });
        }
        else {
            await sock.sendMessage(chatId, { 
                text: '❌ Invalid!\nCommands:\n.autostatus on/off\n.autostatus react on/off\n.autostatus random on/off\n.autostatus emoji [emoji]\n.autostatus cache clear\n.autostatus preload'
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

// Enhanced handleStatusUpdate with LID support
async function handleStatusUpdate(sock, status) {
    try {
        if (!isAutoStatusEnabled()) return;

        // Small delay to ensure status is processed
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Handle different status formats
        let statusKey = null;

        if (status.messages && status.messages.length > 0) {
            const msg = status.messages[0];
            if (msg.key && msg.key.remoteJid === 'status@broadcast') {
                statusKey = msg.key;
            }
        } else if (status.key && status.key.remoteJid === 'status@broadcast') {
            statusKey = status.key;
        } else if (status.reaction && status.reaction.key.remoteJid === 'status@broadcast') {
            statusKey = status.reaction.key;
        }

        if (!statusKey) return;

        // Read the status
        try {
            await sock.readMessages([statusKey]);
            console.log('👁️ Status viewed');
        } catch (err) {
            if (err.message?.includes('rate-overlimit')) {
                console.log('⚠️ Rate limit on view, retrying...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                await sock.readMessages([statusKey]);
            } else throw err;
        }

        // React if enabled
        if (isStatusReactionEnabled()) {
            // Try to resolve LID first for efficient reaction
            const lid = await resolveLid(sock, statusKey.participant || statusKey.remoteJid);
            if (lid) {
                console.log(`🔍 Resolved LID: ${lid}`);
            }
            
            await reactToStatus(sock, statusKey);
        }

    } catch (error) {
        console.error('❌ Error in auto status handler:', error.message);
    }
}

module.exports = {
    autoStatusCommand,
    handleStatusUpdate,
    preloadContactLids,
    resolveLid
};
