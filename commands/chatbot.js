const path = require('path');
const fetch = require('node-fetch');
const fs = require('fs');
const os = require('os');
const axios = require('axios');
const FormData = require('form-data');
const yts = require('yt-search');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
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

        // Check for @mention in conversation text or media captions
        const textSources = [
            message.message?.conversation,
            message.message?.imageMessage?.caption,
            message.message?.videoMessage?.caption,
            message.message?.extendedTextMessage?.text
        ];
        for (const text of textSources) {
            if (text && text.includes(`@${botNumber}`)) return true;
        }

        // Check mentionedJid in image/video/audio messages
        const mediaMentions =
            message.message?.imageMessage?.contextInfo?.mentionedJid ||
            message.message?.videoMessage?.contextInfo?.mentionedJid ||
            message.message?.audioMessage?.contextInfo?.mentionedJid;
        if (mediaMentions) {
            return mediaMentions.some(jid => {
                const cleanJid = jid.split(':')[0].split('@')[0];
                return cleanJid === botNumber;
            });
        }

        return false;
    } catch (error) {
        return false;
    }
}

// Check if message is a reply to ANY message (not just bot)
function isReplyToAnyMessage(message) {
    try {
        const contextInfo = message.message?.extendedTextMessage?.contextInfo;
        if (!contextInfo) return false;
        
        // Check if there's a quoted message (stanzaId or quotedMessage)
        return !!(contextInfo.stanzaId || contextInfo.quotedMessage);
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
        // Chatbot only works in groups
        if (!chatId.endsWith('@g.us')) return;

        // Check if chatbot is enabled for this group
        const data = loadUserGroupData();
        const isChatbotEnabled = data.chatbot[chatId] || false;
        if (!isChatbotEnabled) return;

        // UPDATED: Respond when someone replies to ANY message (not just bot's messages)
        const isReplied = isReplyToAnyMessage(message);
        if (!isReplied) return;

        // Don't respond to own messages
        const botId = sock.user.id;
        const botNumber = botId.split(':')[0];
        const senderNum = (senderId || '').split('@')[0].split(':')[0];
        
        if (senderNum === botNumber) {
            return;
        }

        // ---- Detect media type ----
        const msgContent = message.message || {};
        const isImage = !!(msgContent.imageMessage);
        const isVideo = !!(msgContent.videoMessage);
        const isAudio = !!(msgContent.audioMessage || msgContent.pttMessage);

        if (isImage || isVideo || isAudio) {
            try {
                await showTyping(sock, chatId);

                const caption = msgContent.imageMessage?.caption ||
                                msgContent.videoMessage?.caption || '';

                const ext = isImage ? 'jpg' : isVideo ? 'mp4' : 'ogg';
                const buffer = await downloadMediaMessage(message, 'buffer', {}, { sock });
                const mediaUrl = await uploadToTemp(buffer, `chatbot_${Date.now()}.${ext}`);

                let reply;
                if (isImage) {
                    reply = await analyzeImage(mediaUrl, caption);
                } else {
                    // audio or video — transcribe then AI-respond
                    const transcript = await transcribeAndRespond(mediaUrl, sock, chatId, message);
                    if (transcript) {
                        const aiReply = await getAIResponse(transcript, {
                            messages: chatMemory.messages.get(senderId) || [],
                            userInfo: chatMemory.userInfo.get(senderId) || {}
                        }).catch(() => null);
                        reply = isAudio
                            ? `🎤 *I heard:* _${transcript}_\n\n${aiReply || getFallbackResponse(transcript)}`
                            : `🎬 *Video audio:* _${transcript}_\n\n${aiReply || getFallbackResponse(transcript)}`;
                    } else {
                        reply = isAudio
                            ? "🎤 I received your voice message but couldn't transcribe it clearly. Could you type your message instead?"
                            : "🎬 I received your video but couldn't extract audio from it. Could you describe what you need?";
                    }
                }

                await new Promise(resolve => setTimeout(resolve, getRandomDelay()));
                await sock.sendMessage(chatId, {
                    text: reply.substring(0, 1500)
                }, { quoted: createFakeContact(message) });
            } catch (mediaErr) {
                console.error('Chatbot media error:', mediaErr);
                await sock.sendMessage(chatId, {
                    text: '⚠️ I had trouble processing that media. Please try again or type your message.'
                }, { quoted: createFakeContact(message) });
            }
            return;
        }

        // Clean the message text
        const cleanedMessage = cleanMessageText(message, botId);
        if (!cleanedMessage || cleanedMessage.trim().length === 0) {
            return;
        }

        // Check if message is a download request (song or video) - ENHANCED DETECTION
        const dlRequest = detectDownloadRequest(cleanedMessage);
        if (dlRequest) {
            try {
                if (dlRequest.type === 'song') {
                    await downloadSongForChat(sock, chatId, message, dlRequest.query, senderId);
                } else {
                    await downloadVideoForChat(sock, chatId, message, dlRequest.query, senderId);
                }
            } catch (dlErr) {
                console.error('Chatbot download error:', dlErr);
                await sock.sendMessage(chatId, {
                    text: '❌ Sorry, I had trouble downloading that. Please try again.'
                }, { quoted: createFakeContact(message) });
            }
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

// ==================== DOWNLOAD HELPERS ====================

// Enhanced download request detection with more patterns
function detectDownloadRequest(text) {
    const lower = text.toLowerCase().trim();

    // More comprehensive patterns for song detection
    const songPatterns = [
        // "play song name", "download song name", etc
        /^(?:play|download|get|give me|find|send me|i want)\s+(?:the\s+)?(?:song|audio|music|track|mp3)?\s*(?:of|for|called|named|by)?\s+(.+?)(?:\s+(?:song|audio|music|track|mp3))?$/i,
        
        // "song song name", "music name", etc
        /^(?:song|audio|music|track|mp3)\s+(?:of|for|called|named)?\s+(.+)$/i,
        
        // "play name song"
        /^(?:play|send me|download)\s+(.+?)\s+(?:song|audio|music|mp3)$/i,
        
        // Direct YouTube links or queries
        /^(?:yt|youtube)\s+(?:song|audio|music)?\s*(.+)$/i,
        
        // "can you play name"
        /^(?:can you|could you|please)\s+(?:play|download|get)\s+(.+)$/i,
        
        // "I want to hear name"
        /^(?:i want to|i'd like to)\s+(?:hear|listen to|download)\s+(.+)$/i
    ];

    // Patterns for video detection
    const videoPatterns = [
        /^(?:play|download|get|give me|find|send me|watch)\s+(?:the\s+)?(?:video|clip|mv|youtube)\s*(?:of|for|called|named)?\s+(.+?)(?:\s+(?:video|clip|mv))?$/i,
        /^(?:video|clip|mv)\s+(?:of|for|called|named)?\s+(.+)$/i,
        /^(?:play|send me|download)\s+(.+?)\s+(?:video|clip|mv)$/i,
        /^(?:yt|youtube)\s+video\s+(.+)$/i,
        /^(?:can you|could you|please)\s+(?:play|show|download)\s+(?:a\s+)?video\s+(?:of|for)?\s+(.+)$/i
    ];

    // Check for video first (more specific)
    for (const pattern of videoPatterns) {
        const m = lower.match(pattern);
        if (m && m[1] && m[1].length > 2) {
            return { type: 'video', query: m[1].trim() };
        }
    }
    
    // Then check for songs
    for (const pattern of songPatterns) {
        const m = lower.match(pattern);
        if (m && m[1] && m[1].length > 2) {
            // Filter out common false positives
            const query = m[1].trim();
            const ignoreList = ['hello', 'hi', 'hey', 'thanks', 'thank you', 'bye', 'goodbye'];
            if (!ignoreList.includes(query.toLowerCase())) {
                return { type: 'song', query: query };
            }
        }
    }
    
    return null;
}

// Enhanced download function with multiple API sources
async function downloadSongForChat(sock, chatId, message, query, senderId) {
    const loadingMsg = await sock.sendMessage(chatId, { 
        text: `🔍 Searching for *"${query}"*...` 
    }, { quoted: createFakeContact(message) });
    
    await sock.sendMessage(chatId, { react: { text: '🎵', key: message.key } });
    
    const tempDir = path.join(os.tmpdir(), 'june-x-temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    try {
        // Search for the song
        const searchResult = (await yts(query + ' song official audio')).videos[0];
        if (!searchResult) {
            await sock.sendMessage(chatId, { 
                text: `😕 Couldn't find a song for: *${query}*`, 
                edit: loadingMsg.key 
            }, { quoted: createFakeContact(message) });
            return;
        }

        await sock.sendMessage(chatId, { 
            text: `📥 Found: *${searchResult.title}*\nDuration: ${searchResult.timestamp}\nDownloading...`, 
            edit: loadingMsg.key 
        });

        // Try multiple download APIs
        let downloadUrl = null;
        let videoTitle = searchResult.title;
        
        const apis = [
            {
                url: `https://www.apiskeith.top/download/audio?url=${encodeURIComponent(searchResult.url)}`,
                handler: (res) => res.data?.result ? { url: res.data.result, title: res.data.title } : null
            },
            {
                url: `https://api.ryzendesu.vip/api/downloader/ytmp3?url=${encodeURIComponent(searchResult.url)}`,
                handler: (res) => res.data?.url ? { url: res.data.url, title: res.data.title } : null
            },
            {
                url: `https://api.giftedtech.co.ke/api/download/ytmp3?apikey=gifted&url=${encodeURIComponent(searchResult.url)}`,
                handler: (res) => res.data?.result?.download_url ? { url: res.data.result.download_url, title: res.data.result.title } : null
            },
            {
                url: `https://pikabotzapi.vercel.app/api/downloader/ytmp3?url=${encodeURIComponent(searchResult.url)}`,
                handler: (res) => res.data?.result?.download ? { url: res.data.result.download, title: res.data.result.title } : null
            },
            {
                url: `https://api.davidcyriltech.my.id/download/ytmp3?url=${encodeURIComponent(searchResult.url)}`,
                handler: (res) => res.data?.downloadUrl ? { url: res.data.downloadUrl, title: res.data.title } : null
            }
        ];

        for (const api of apis) {
            try {
                const res = await axios.get(api.url, { timeout: 30000 });
                const result = api.handler(res);
                if (result?.url) {
                    downloadUrl = result.url;
                    videoTitle = result.title || searchResult.title;
                    break;
                }
            } catch (_) { continue; }
        }

        if (!downloadUrl) {
            // Fallback to direct YouTube download attempt
            try {
                const directRes = await axios.get(`https://youtube-mp3.downloader.now/api?url=${encodeURIComponent(searchResult.url)}`, { timeout: 30000 });
                if (directRes.data?.link) {
                    downloadUrl = directRes.data.link;
                }
            } catch (_) {}
        }

        if (!downloadUrl) {
            await sock.sendMessage(chatId, { 
                text: '❌ Could not download that song right now. Try again later.',
                edit: loadingMsg.key 
            }, { quoted: createFakeContact(message) });
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return;
        }

        // Download the file
        const filePath = path.join(tempDir, `song_${Date.now()}.mp3`);
        const writer = fs.createWriteStream(filePath);
        
        const audioRes = await axios({ 
            method: 'get', 
            url: downloadUrl, 
            responseType: 'stream', 
            timeout: 120000, 
            maxContentLength: 50 * 1024 * 1024 // 50MB limit
        });
        
        audioRes.data.pipe(writer);
        
        await new Promise((resolve, reject) => { 
            writer.on('finish', resolve); 
            writer.on('error', reject);
        });

        // Send the audio
        await sock.sendMessage(chatId, { 
            text: `🎵 *${videoTitle || searchResult.title}*\n_Song requested by @${senderId.split('@')[0]}_`, 
            mentions: [senderId],
            edit: loadingMsg.key 
        });

        await sock.sendMessage(chatId, { 
            audio: { url: filePath }, 
            mimetype: 'audio/mpeg', 
            fileName: `${(videoTitle || searchResult.title).substring(0, 80)}.mp3`, 
            ptt: false 
        }, { quoted: createFakeContact(message) });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

        // Cleanup
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    } catch (error) {
        console.error('Download error:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Error downloading song. Please try again.',
            edit: loadingMsg.key 
        }, { quoted: createFakeContact(message) });
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
    }
}

async function downloadVideoForChat(sock, chatId, message, query, senderId) {
    const loadingMsg = await sock.sendMessage(chatId, { 
        text: `🔍 Searching for video: *"${query}"*...` 
    }, { quoted: createFakeContact(message) });
    
    await sock.sendMessage(chatId, { react: { text: '🎬', key: message.key } });

    try {
        const searchResult = (await yts(query + ' video')).videos[0];
        if (!searchResult) {
            await sock.sendMessage(chatId, { 
                text: `😕 Couldn't find a video for: *${query}*`,
                edit: loadingMsg.key 
            }, { quoted: createFakeContact(message) });
            return;
        }

        await sock.sendMessage(chatId, { 
            text: `📥 Found: *${searchResult.title}*\nDuration: ${searchResult.timestamp}\nDownloading video...`, 
            edit: loadingMsg.key 
        });

        // Try multiple video download APIs
        let downloadUrl = null;
        
        const apis = [
            `https://iamtkm.vercel.app/downloaders/ytmp4?apikey=tkm&url=${searchResult.url}`,
            `https://api.davidcyriltech.my.id/download/ytmp4?url=${encodeURIComponent(searchResult.url)}`,
            `https://pikabotzapi.vercel.app/api/downloader/ytmp4?url=${encodeURIComponent(searchResult.url)}`,
            `https://api.giftedtech.co.ke/api/download/ytmp4?apikey=gifted&url=${encodeURIComponent(searchResult.url)}`
        ];

        for (const api of apis) {
            try {
                const res = await axios.get(api, { timeout: 30000 });
                
                if (api.includes('iamtkm') && res.data?.data?.url) {
                    downloadUrl = res.data.data.url;
                    break;
                } else if (api.includes('davidcyriltech') && res.data?.downloadUrl) {
                    downloadUrl = res.data.downloadUrl;
                    break;
                } else if (api.includes('pikabotzapi') && res.data?.result?.download) {
                    downloadUrl = res.data.result.download;
                    break;
                } else if (api.includes('gifted') && res.data?.result?.download_url) {
                    downloadUrl = res.data.result.download_url;
                    break;
                }
            } catch (_) { continue; }
        }

        if (!downloadUrl) {
            await sock.sendMessage(chatId, { 
                text: '❌ Could not download that video right now. Try again later.',
                edit: loadingMsg.key 
            }, { quoted: createFakeContact(message) });
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
            return;
        }

        await sock.sendMessage(chatId, { 
            text: `🎬 *${searchResult.title}*\n_Video requested by @${senderId.split('@')[0]}_`, 
            mentions: [senderId],
            edit: loadingMsg.key 
        });

        await sock.sendMessage(chatId, { 
            video: { url: downloadUrl }, 
            mimetype: 'video/mp4', 
            caption: `🎬 ${searchResult.title}`
        }, { quoted: createFakeContact(message) });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (error) {
        console.error('Video download error:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Error downloading video. Please try again.',
            edit: loadingMsg.key 
        }, { quoted: createFakeContact(message) });
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
    }
}

// ==================== MEDIA HELPERS ====================

async function uploadToTemp(buffer, filename) {
    const formData = new FormData();
    formData.append('files[]', buffer, { filename });
    const res = await axios.post('https://uguu.se/upload.php', formData, {
        headers: formData.getHeaders(),
        timeout: 30000
    });
    const url = res.data.files?.[0]?.url;
    if (!url) throw new Error('Upload failed');
    return url;
}

async function analyzeImage(imageUrl, caption) {
    const question = caption
        ? `Describe this image and answer: ${caption}`
        : 'Describe what you see in this image in detail.';

    const apis = [
        `https://bk9.fun/ai/gemini-pro-vision?q=${encodeURIComponent(question)}&url=${encodeURIComponent(imageUrl)}`,
        `https://apiskeith.top/ai/gemini-vision?q=${encodeURIComponent(question)}&url=${encodeURIComponent(imageUrl)}`
    ];

    for (const url of apis) {
        try {
            const res = await axios.get(url, { timeout: 30000 });
            const data = res.data;
            const text = data?.BK9 || data?.result || data?.response || data?.text || data?.message;
            if (text && typeof text === 'string' && text.trim().length > 0) {
                return text.trim();
            }
        } catch (_) {}
    }
    return '🖼️ I can see the image but I\'m having trouble analyzing it right now. Could you describe what you\'d like to know about it?';
}

async function transcribeAndRespond(mediaUrl, sock, chatId, message) {
    try {
        const transcribeUrl = `https://apiskeith.top/ai/transcribe?q=${encodeURIComponent(mediaUrl)}`;
        const res = await axios.get(transcribeUrl, { timeout: 60000 });
        const transcript = res.data?.result?.text?.trim();
        if (!transcript) return null;
        return transcript;
    } catch (_) {
        return null;
    }
}

// ==================== EXPORTS ====================

module.exports = {
    handleChatbotCommand,
    handleChatbotResponse
};
