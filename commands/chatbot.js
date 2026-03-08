const path = require('path');
const fetch = require('node-fetch');
const fs = require('fs');
const { getBotName } = require('../lib/botConfig');

// ==================== DATA MANAGEMENT ====================

// Path to user group data file
const DATA_FILE = path.join(__dirname, '../Database/userGroupData.json');

// Initialize default data structure
const defaultData = {
    chatbot: {},
    settings: {},
    users: {},
    groups: {}
};

// Load user group data from file
const { createFakeContact } = require('../lib/fakeContact');
function loadUserGroupData() {
    try {
        // Check if directory exists, if not create it
        const dbDir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        // Check if file exists
        if (!fs.existsSync(DATA_FILE)) {
            // Create file with default data
            fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
            return { ...defaultData };
        }

        // Read and parse file
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return { ...defaultData };
    }
}

// Save user group data to file
function saveUserGroupData(data) {
    try {
        // Check if directory exists, if not create it
        const dbDir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        // Write data to file
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        return false;
    }
}

// ==================== CHAT MEMORY ====================

const chatMemory = {
    messages: new Map(),
    userInfo: new Map()
};

// ==================== UTILITY FUNCTIONS ====================

// Add random delay between 2-5 seconds
function getRandomDelay() {
    return Math.floor(Math.random() * 3000) + 2000;
}

// Add typing indicator
async function showTyping(sock, chatId) {
    try {
        await sock.presenceSubscribe(chatId);
        await sock.sendPresenceUpdate('composing', chatId);
        await new Promise(resolve => setTimeout(resolve, getRandomDelay()));
    } catch (error) {
        // Silent fail
    }
}

// Extract user information from messages
function extractUserInfo(message) {
    const info = {};
    
    // Extract name
    if (message.toLowerCase().includes('my name is')) {
        info.name = message.split('my name is')[1].trim().split(' ')[0];
    }
    
    // Extract age
    if (message.toLowerCase().includes('i am') && message.toLowerCase().includes('years old')) {
        const ageMatch = message.match(/\d+/);
        if (ageMatch) info.age = ageMatch[0];
    }
    
    // Extract location
    if (message.toLowerCase().includes('i live in') || message.toLowerCase().includes('i am from')) {
        const locationMatch = message.split(/(?:i live in|i am from)/i)[1]?.trim().split(/[.,!?]/)[0];
        if (locationMatch) info.location = locationMatch;
    }
    
    return info;
}

// ==================== SETTINGS STORE ====================

// Path to settings file
const SETTINGS_FILE = path.join(__dirname, '../Database/groupSettings.json');

// Default settings structure
const defaultSettings = {
    groups: {},
    global: {
        antilink: false,
        welcome: false,
        goodbye: false,
        chatbot: false,
        nsfw: false,
        economy: false,
        game: false
    }
};

// Load settings from file
function loadSettings() {
    try {
        // Check if file exists
        if (!fs.existsSync(SETTINGS_FILE)) {
            // Create file with default settings
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2));
            return { ...defaultSettings };
        }

        // Read and parse file
        const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return { ...defaultSettings };
    }
}

// Save settings to file
function saveSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
        return true;
    } catch (error) {
        return false;
    }
}

// Set group configuration
function setGroupConfig(chatId, key, value) {
    const settings = loadSettings();
    
    // Initialize group settings if not exists
    if (!settings.groups[chatId]) {
        settings.groups[chatId] = {
            ...defaultSettings.global,
            welcomeMessage: '',
            goodbyeMessage: '',
            antilinkAction: 'delete',
            bannedWords: [],
            allowedLinks: [],
            welcomeMedia: null,
            goodbyeMedia: null,
            customCommands: {}
        };
    }

    // Check if it's a global setting
    if (key in settings.global) {
        settings.global[key] = value;
    } else {
        // Group-specific setting
        settings.groups[chatId][key] = value;
    }

    return saveSettings(settings);
}

// ==================== HELPER FUNCTIONS ====================

// Extract sender ID properly from message
function getSenderId(message) {
    try {
        // Try to get from key.participant (for groups)
        if (message.key?.participant) {
            return message.key.participant.split(':')[0] + '@s.whatsapp.net';
        }
        
        // Try to get from participant field
        if (message.participant) {
            return message.participant.split(':')[0] + '@s.whatsapp.net';
        }
        
        // Try to get from pushName (for DMs)
        if (message.pushName) {
            // This is a fallback, not reliable for ID
            return null;
        }
        
        // Last resort: use remoteJid if it's a DM (not a group)
        if (message.key?.remoteJid && !message.key.remoteJid.endsWith('@g.us')) {
            return message.key.remoteJid.split(':')[0] + '@s.whatsapp.net';
        }
        
        return null;
    } catch (error) {
        return null;
    }
}

// Check if user is admin in group
async function isUserAdmin(sock, chatId, userId) {
    if (!chatId.endsWith('@g.us')) return false;
    
    try {
        const groupMetadata = await sock.groupMetadata(chatId);
        
        // Clean the user ID for comparison
        const cleanUserId = userId.split(':')[0].split('@')[0];
        
        // Check if user is in group and has admin privileges
        const participant = groupMetadata.participants.find(p => {
            const cleanParticipantId = p.id.split(':')[0].split('@')[0];
            return cleanParticipantId === cleanUserId;
        });
        
        return participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
    } catch (error) {
        return false;
    }
}

// Check if bot is mentioned in message
function isBotMentioned(message, botId) {
    try {
        const botNumber = botId.split(':')[0].split('@')[0];
        const botJids = [
            botId,
            `${botNumber}@s.whatsapp.net`,
            `${botNumber}@whatsapp.net`
        ];

        // Check for mentions in extended text message
        if (message.message?.extendedTextMessage?.contextInfo?.mentionedJid) {
            const mentionedJids = message.message.extendedTextMessage.contextInfo.mentionedJid;
            return mentionedJids.some(jid => {
                const cleanJid = jid.split(':')[0].split('@')[0];
                return botJids.some(botJid => {
                    const cleanBot = botJid.split(':')[0].split('@')[0];
                    return cleanJid === cleanBot;
                });
            });
        }

        // Check for @mention in conversation text
        if (message.message?.conversation) {
            const text = message.message.conversation;
            return text.includes(`@${botNumber}`);
        }

        return false;
    } catch (error) {
        return false;
    }
}

// Check if message is a reply to bot's message
function isReplyToBot(message, botId) {
    try {
        const contextInfo = message.message?.extendedTextMessage?.contextInfo;
        if (!contextInfo) return false;

        const quotedParticipant = contextInfo.participant;
        if (!quotedParticipant) return false;

        const botNumber = botId.split(':')[0].split('@')[0];
        const cleanQuoted = quotedParticipant.split(':')[0].split('@')[0];
        
        return cleanQuoted === botNumber;
    } catch (error) {
        return false;
    }
}

// Check if message is in direct message (private chat)
function isDirectMessage(chatId) {
    return !chatId.endsWith('@g.us');
}

// Clean message text by removing mentions
function cleanMessageText(message, botId) {
    try {
        let text = '';
        
        // Extract text from different message types
        if (message.message?.conversation) {
            text = message.message.conversation;
        } else if (message.message?.extendedTextMessage?.text) {
            text = message.message.extendedTextMessage.text;
        } else if (message.message?.imageMessage?.caption) {
            text = message.message.imageMessage.caption;
        } else if (message.message?.videoMessage?.caption) {
            text = message.message.videoMessage.caption;
        } else {
            return '';
        }

        // Remove bot mention if present
        const botNumber = botId.split(':')[0].split('@')[0];
        const mentionRegex = new RegExp(`@${botNumber}\\s*`, 'g');
        text = text.replace(mentionRegex, '').trim();

        return text;
    } catch (error) {
        return '';
    }
}

// ==================== CHATBOT COMMAND HANDLER ====================

async function handleChatbotCommand(sock, chatId, message, match) {
    if (!match) {
        await showTyping(sock, chatId);
        return sock.sendMessage(chatId, {
            text: `*CHATBOT SETUP*\n\n*.chatbot on*\nEnable chatbot\n\n*.chatbot off*\nDisable chatbot in this group`,
            quoted: message
        });
    }

    const data = loadUserGroupData();
    
    // Get bot's number
    const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    
    // Get sender ID properly
    const senderId = getSenderId(message);
    
    if (!senderId) {
        return;
    }
    
    // Check if sender is bot owner (compare just the numbers)
    const cleanBotNumber = botNumber.split('@')[0];
    const cleanSenderId = senderId.split('@')[0];
    const isOwner = cleanSenderId === cleanBotNumber;

    // For groups, check if user is admin
    let isAdmin = false;
    if (chatId.endsWith('@g.us')) {
        isAdmin = await isUserAdmin(sock, chatId, senderId);
    }

    // Allow access if user is owner OR admin
    if (!isOwner && !isAdmin) {
        await showTyping(sock, chatId);
        return sock.sendMessage(chatId, {
            text: '❌ Only group admins or the bot owner can use this command.',
            quoted: message
        });
    }

    // Handle commands
    if (match === 'on') {
        await showTyping(sock, chatId);
        if (data.chatbot[chatId]) {
            return sock.sendMessage(chatId, { 
                text: '*Chatbot is already enabled for this group*',
                quoted: message
            });
        }
        data.chatbot[chatId] = true;
        saveUserGroupData(data);
        return sock.sendMessage(chatId, { 
            text: '*Chatbot has been enabled for this group*',
            quoted: message
        });
    }

    if (match === 'off') {
        await showTyping(sock, chatId);
        if (!data.chatbot[chatId]) {
            return sock.sendMessage(chatId, { 
                text: '*Chatbot is already disabled for this group*',
                quoted: message
            });
        }
        data.chatbot[chatId] = false;
        saveUserGroupData(data);
        setGroupConfig(chatId, 'chatbot', false);
        return sock.sendMessage(chatId, { 
            text: '*Chatbot has been disabled for this group*',
            quoted: message
        });
    }

    await showTyping(sock, chatId);
    return sock.sendMessage(chatId, { 
        text: '*Invalid command. Use .chatbot to see usage*',
        quoted: message
    });
}

// ==================== CHATBOT RESPONSE HANDLER ====================

async function handleChatbotResponse(sock, chatId, message, userMessage, senderId) {
    try {
        // Check if chatbot is enabled for this chat
        const data = loadUserGroupData();
        const isChatbotEnabled = data.chatbot[chatId] || false;
        
        // For groups, check if bot is mentioned or replied to
        if (chatId.endsWith('@g.us')) {
            const botId = sock.user.id;
            const isMentioned = isBotMentioned(message, botId);
            const isReplied = isReplyToBot(message, botId);
            
            // Only respond if:
            // 1. Chatbot is enabled AND (bot is mentioned OR replied to)
            // OR
            // 2. It's a direct message (always respond in DMs)
            if (!isChatbotEnabled && !isDirectMessage(chatId)) {
                return;
            }
            
            // If chatbot is disabled but bot is mentioned/replied to, still respond
            // This allows occasional interactions even when disabled
            if (!isChatbotEnabled && !isMentioned && !isReplied) {
                return;
            }
        } else {
            // Direct message - always respond
        }

        // Don't respond to own messages
        const botId = sock.user.id;
        const botNumber = botId.split(':')[0];
        const senderNum = (senderId || '').split('@')[0].split(':')[0];
        
        if (senderNum === botNumber) {
            return;
        }

        // Clean the message text
        const cleanedMessage = cleanMessageText(message, botId);
        if (!cleanedMessage || cleanedMessage.trim().length === 0) {
            return;
        }

        // Store in memory
        if (!chatMemory.messages.has(senderId)) {
            chatMemory.messages.set(senderId, []);
            chatMemory.userInfo.set(senderId, {});
        }

        // Extract user info
        const userInfo = extractUserInfo(cleanedMessage);
        if (Object.keys(userInfo).length > 0) {
            chatMemory.userInfo.set(senderId, {
                ...chatMemory.userInfo.get(senderId),
                ...userInfo
            });
        }

        // Store message history
        const messages = chatMemory.messages.get(senderId);
        messages.push(cleanedMessage);
        if (messages.length > 10) {
            messages.shift();
        }
        chatMemory.messages.set(senderId, messages);

        // Show typing indicator
        try {
            await showTyping(sock, chatId);
        } catch (e) {
            // Silent fail
        }

        // Get AI response
        let response;
        try {
            response = await getAIResponse(cleanedMessage, {
                messages: chatMemory.messages.get(senderId),
                userInfo: chatMemory.userInfo.get(senderId)
            });
        } catch (aiErr) {
            response = getFallbackResponse(cleanedMessage);
        }

        if (!response) {
            response = getFallbackResponse(cleanedMessage);
        }

        // Add small delay
        await new Promise(resolve => setTimeout(resolve, getRandomDelay()));

        // Send response
        try {
            await sock.sendMessage(chatId, {
                text: response.substring(0, 1000)
            }, { quoted: createFakeContact(message) });
        } catch (sendErr) {
            try {
                await sock.sendMessage(chatId, {
                    text: response.substring(0, 1000)
                }, { quoted: createFakeContact(message) });
            } catch (e) {
                // Silent fail
            }
        }

    } catch (error) {
        if (error.message && error.message.includes('No sessions')) {
            return;
        }
        try {
            const fallback = getFallbackResponse(userMessage || '');
            await sock.sendMessage(chatId, { text: fallback }, { quoted: createFakeContact(message) });
        } catch (e) {
            // Silent fail
        }
    }
}

// ==================== FALLBACK RESPONSES ====================

// Fallback responses when APIs are down
function getFallbackResponse(message) {
    const lowerMsg = message.toLowerCase();
    const fallbacks = [
        { keywords: ['hi', 'hello', 'hey', 'yo'], response: 'Hey there! What\'s on your mind? 👋' },
        { keywords: ['how are you', 'how r u', 'howdy'], response: 'I\'m doing great! How about you? 😊' },
        { keywords: ['what\'s up', 'sup', 'wassup'], response: 'Not much! What can I help you with? ✨' },
        { keywords: ['bye', 'goodbye', 'see you'], response: 'Catch you later! Take care! 👋' },
        { keywords: ['thanks', 'thank you', 'thx'], response: 'You\'re welcome! Happy to help! 🙌' },
        { keywords: ['who are you', 'what are you'], response: `I'm ${getBotName()}, your friendly WhatsApp assistant! 🤖` },
        { keywords: ['your name', 'whats your name'], response: `I'm ${getBotName()}, created to help and chat with you! ✨` },
        { keywords: ['help', 'what can you do'], response: 'I can chat, answer questions, and help with lots of things! Just ask away. 💫' },
        { keywords: ['good morning', 'morning'], response: 'Good morning! Hope you have an awesome day! ☀️' },
        { keywords: ['good night', 'gn', 'goodnight'], response: 'Good night! Sweet dreams! 🌙' },
        { keywords: ['good afternoon'], response: 'Good afternoon! How\'s your day going? ⛅' },
        { keywords: ['good evening'], response: 'Good evening! How was your day? 🌆' }
    ];

    for (const fb of fallbacks) {
        if (fb.keywords.some(k => lowerMsg.includes(k))) {
            return fb.response;
        }
    }

    const defaultResponses = [
        "Hmm, interesting! Tell me more. 🤔",
        "Really? That's cool! 😎",
        "I see... what else? 👀",
        "Yeah, I get what you mean! 💯",
        "That's a great point! 🎯",
        "No way! That's wild! 🔥",
        "Oh, I didn't know that! 😮",
        "Nice one! 👍",
        "Go on, I'm listening! 👂",
        "That's pretty awesome! ⚡"
    ];
    
    return defaultResponses[Math.floor(Math.random() * defaultResponses.length)];
}

// ==================== AI RESPONSE FUNCTION ====================

// Main AI response function with multiple APIs
async function getAIResponse(userMessage, userContext) {
    // Create system prompt with context
    const recentMessages = userContext.messages.slice(-5).join('\n');
    const userInfo = userContext.userInfo;
    
    let userInfoStr = '';
    if (Object.keys(userInfo).length > 0) {
        userInfoStr = `User info: ${JSON.stringify(userInfo)}`;
    }

    const systemPrompt = `You are ${getBotName()}, a smart and friendly assistant chatting on WhatsApp. Created by June.

CORE RULES:
1. Always respond in clear English
2. Keep responses concise but helpful - 2-4 lines max
3. Be friendly, witty, and use emojis occasionally
4. Never mention you're an AI or bot - you're ${getBotName()}
5. Match the user's language - if they write in English, respond in English
6. Be knowledgeable and give accurate, helpful answers
7. If someone greets you, greet them back warmly

ABOUT YOU:
- Name: ${getBotName()}
- Creator: June
- You're intelligent, helpful, and have a good sense of humor
- You can help with questions, have conversations, and provide information

${userInfoStr}
Previous chat: ${recentMessages}`;

    const apis = [
        {
            name: 'GPT-5',
            url: `https://iamtkm.vercel.app/ai/gpt5?apikey=tkm&text=${encodeURIComponent(systemPrompt + '\n\nUser: ' + userMessage)}`,
            method: 'GET',
            parseResponse: (data) => {
                return data.result || data.response || data.message || data.text || null;
            }
        },
        {
            name: 'Wolf Gemini',
            url: 'https://apis.xwolf.space/api/ai/gemini',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: { 
                prompt: systemPrompt + '\n\nUser: ' + userMessage,
                system: systemPrompt
            },
            parseResponse: (data) => {
                return data.result || 
                       data.response || 
                       data.message || 
                       data.text || 
                       data.data?.result ||
                       data.data?.response ||
                       data.data?.message ||
                       data.data?.text ||
                       data.candidates?.[0]?.content ||
                       null;
            }
        },
        {
            name: 'BK9 API',
            url: `https://bk9.fun/ai/gemini?q=${encodeURIComponent(systemPrompt + '\n\nUser: ' + userMessage)}`,
            method: 'GET',
            parseResponse: (data) => {
                return data.BK9 || data.result || data.response || data.message || null;
            }
        }
    ];

    // Try each API in sequence
    for (const api of apis) {
        try {
            let response;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);

            if (api.method === 'POST') {
                response = await fetch(api.url, {
                    method: 'POST',
                    headers: api.headers || { 'Content-Type': 'application/json' },
                    body: JSON.stringify(api.body),
                    signal: controller.signal
                });
            } else {
                const url = new URL(api.url);
                if (api.params) {
                    Object.entries(api.params).forEach(([key, value]) => {
                        if (value) url.searchParams.append(key, encodeURIComponent(value));
                    });
                }
                response = await fetch(url.toString(), {
                    method: 'GET',
                    signal: controller.signal,
                    headers: { 'Accept': 'application/json' }
                });
            }
            
            clearTimeout(timeout);

            if (!response.ok) {
                continue;
            }

            const data = await response.json();
            
            // Parse response using API-specific parser
            let result = api.parseResponse(data);
            
            if (result && typeof result === 'string' && result.trim().length > 0) {
                // Clean up the response
                return result
                    .replace(/^["']|["']$/g, '') // Remove quotes
                    .replace(/\\n/g, '\n')
                    .replace(/\\/g, '')
                    .trim();
            }

        } catch (error) {
            continue;
        }
    }

    // If all APIs fail, use fallback responses
    return getFallbackResponse(userMessage);
}

// ==================== EXPORTS ====================

module.exports = {
    handleChatbotCommand,
    handleChatbotResponse
};
