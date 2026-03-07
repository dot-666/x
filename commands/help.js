/**
- help.js - 
- Enhanced version with integrated functions
- supreme + casper
*/
const settings = require('../settings');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getMenuStyle, getMenuSettings, getMenuImage, MENU_STYLES } = require('./menuSettings');
const { generateWAMessageFromContent } = require('@whiskeysockets/baileys');
const { getPrefix, handleSetPrefixCommand } = require('./setprefix');
const { getOwnerName, handleSetOwnerCommand } = require('./setowner');
const setBotNameCommand = require('./setbotname')
const more = String.fromCharCode(8206);
const readmore = more.repeat(4001);

// Utility Functions
function formatTime(seconds) {
    const days = Math.floor(seconds / (24 * 60 * 60));
    seconds = seconds % (24 * 60 * 60);
    const hours = Math.floor(seconds / (60 * 60));
    seconds = seconds % (60 * 60);
    const minutes = Math.floor(seconds / 60);
    seconds = Math.floor(seconds % 60);

    let time = '';
    if (days > 0) time += `${days}d `;
    if (hours > 0) time += `${hours}h `;
    if (minutes > 0) time += `${minutes}m `;
    if (seconds > 0 || time === '') time += `${seconds}s`;

    return time.trim();
}

// Detect host/platform
const detectPlatform = () => {
  if (process.env.DYNO) return "☁️ Heroku";
  if (process.env.RENDER) return "⚡ Render";
  if (process.env.PREFIX && process.env.PREFIX.includes("termux")) return "📱 Termux";
  if (process.env.PORTS && process.env.CYPHERX_HOST_ID) return "🌀 CypherX Platform";
  if (process.env.P_SERVER_UUID) return "🖥️ Panel";
  if (process.env.LXC) return "📦 Linux Container (LXC)";
  
  switch (os.platform()) {
    case "win32": return "🪟 Windows";
    case "darwin": return "🍎 macOS";
    case "linux": return "🐧 Linux";
    default: return "❓ Unknown";
  }
};

// Memory formatting function
const formatMemory = (memory) => {
    return memory < 1024 * 1024 * 1024
        ? Math.round(memory / 1024 / 1024) + ' MB'
        : Math.round(memory / 1024 / 1024 / 1024) + ' GB';
};

// Progress bar function
const progressBar = (used, total, size = 10) => {
    let percentage = Math.round((used / total) * size);
    let bar = '█'.repeat(percentage) + '░'.repeat(size - percentage);
    return `${bar} ${Math.round((used / total) * 100)}%`;
};

const COMMAND_CATEGORIES = {
    'OWNER MENU': [
        'mode', 'autostatus', 'antidelete', 'autoread', 'autotyping',
        'autoreact', 'pmblocker', 'setpp', 'clearsession', 'cleartmp',
        'sudo', 'setprefix', 'setowner', 'setmenu', 'restart', 
        'menuimage', 'configimage'
    ],
    'GROUP ADMIN': [
        'promote', 'demote', 'kick', 'mute', 'unmute', 'ban', 'unban',
        'warn', 'warnings', 'add', 'antilink', 'antibadword', 'antitag',
        'antisticker', 'antidemote', 'welcome', 'goodbye',
        'setgdesc', 'setgname', 'setgpp', 'open', 'close',
        'resetlink', 'link', 'revoke', 'antisticker', 'antiimage'
    ],
    'GROUP TOOLS': [
        'tagall', 'tag', 'hidetag', 'tagnoadmin', 'mention',
        'groupinfo', 'admins', 'leave', 'pair',
        'chatbot', 'clear', 'delete'
    ],
    'AI MENU': [
        'gpt', 'gemini', 'copilot', 'deepseek', 'meta', 'metai',
        'vision', 'analyse', 'ilama', 'wormgpt', 'birdai',
        'perplexity', 'mistral', 'grok', 'speechwrite',
        'imagine', 'flux'
    ],
    'DOWNLOADER': [
        'play', 'song', 'video', 'ytplay', 'ytv', 'ytdocplay',
        'ytdocvideo', 'spotify', 'instagram', 'facebook', 'tiktok',
        'mediafire', 'mf', 'apk', 'gitclone'
    ],
    'SEARCH & TOOLS': [
        'yts', 'ytsearch', 'img', 'image', 'movie',
        'shazam', 'fetch', 'ssweb', 'trt',
        'transcribe', 'locate', 'location', 'url', 'tourl',
        'vcf', 'ping', 'runtime', 'alive', 'vv',
        'block', 'listblock', 'enc'
    ],
    'STICKER MENU': [
        'sticker', 'stickercrop', 'tgsticker', 'take', 'emojimix',
        'meme', 'smeme', 'blur', 'removebg', 'simage', 'toimage'
    ],
    'CONVERTER': [
        'totext', 'toimage', 'toaudio', 'tomp3', 'toppt', 'tourl',
        'gptedit', 'pinterest', 'terabox'
    ],
    'GAME MENU': [
        'tictactoe', 'connect4', 'hangman', 'trivia', 'answer',
        'truth', 'dare', '8ball', 'cf'
    ],
    'FUN & SOCIAL': [
        'compliment', 'insult', 'flirt', 'shayari', 'goodnight',
        'roseday', 'character', 'ship', 'simp', 'wasted', 'stupid',
        'joke', 'quote', 'fact'
    ],
    'ANIME MENU': [
        'neko', 'waifu', 'loli', 'nom', 'poke', 'cry',
        'kiss', 'pat', 'hug', 'wink', 'facepalm', 'anime'
    ],
    'TEXT MAKER': [
        'metallic', 'ice', 'snow', 'impressive', 'matrix', 'light',
        'neon', 'devil', 'purple', 'thunder', 'leaves', '1917',
        'arena', 'hacker', 'sand', 'blackpink', 'glitch', 'fire'
    ],
    'IMG EDIT': [
        'heart', 'horny', 'circle', 'lgbt', 'lolice',
        'namecard', 'tweet', 'ytcomment', 'comrade',
        'gay', 'glass', 'jail', 'passed', 'triggered'
    ],
    'GITHUB': [
        'git', 'github', 'sc', 'script', 'repo', 'clone'
    ]
};

const generateMenu = (pushname, currentMode, hostName, ping, uptimeFormatted, prefix = '.') => {
    const memoryUsage = process.memoryUsage();
    const botUsedMemory = memoryUsage.heapUsed;
    const totalMemory = os.totalmem();
    const systemUsedMemory = totalMemory - os.freemem();
    const prefix2 = getPrefix();
    const bot = setBotNameCommand();
    let newOwner = getOwnerName();
    const menuSettings = getMenuSettings();
    
    let menu = `┏❐✦ ${bot} ✦❐\n`;
    menu += `┃✦ Prefix: [${prefix2}]\n`;
    menu += `┃✦ Owner: ${newOwner}\n`;
    menu += `┃✦ Mode: ${currentMode}\n`;
    menu += `┃✦ Platform: ${hostName}\n`;
    menu += `┃✦ Speed: ${ping} ms\n`;
    
    if (menuSettings.showUptime) {
        menu += `┃✦ Uptime: ${uptimeFormatted}\n`;
    }
    
    menu += `┃✦ Version: v${settings.version}\n`;
    
    if (menuSettings.showMemory) {
        menu += `┃✦ Usage: ${formatMemory(botUsedMemory)} of ${formatMemory(totalMemory)}\n`;
        menu += `┃✦ RAM: [${progressBar(systemUsedMemory, totalMemory)}]\n`;
    }
    
    menu += `┗❐\n${readmore}\n`;

    let sectionIndex = 0;
    for (const [category, commands] of Object.entries(COMMAND_CATEGORIES)) {
        menu += `┏❐ \`${category}\` ❐\n`;
        for (const cmd of commands) {
            menu += `┃ ${prefix2}${cmd}\n`;
        }
        menu += `┗❐\n`;
        sectionIndex++;
        if (sectionIndex % 3 === 0) {
            menu += `${readmore}\n`;
        } else {
            menu += `\n`;
        }
    }

    return menu;
};

// Helper function to safely load thumbnail (with URL support)
async function loadThumbnail(thumbnailPath) {
    try {
        // Handle URL thumbnails
        if (thumbnailPath && (thumbnailPath.startsWith('http://') || thumbnailPath.startsWith('https://'))) {
            try {
                const fetch = require('node-fetch');
                const response = await fetch(thumbnailPath);
                if (response.ok) {
                    return Buffer.from(await response.arrayBuffer());
                }
            } catch (urlError) {
                console.error('URL thumbnail fetch failed:', urlError.message);
            }
            // Fall through to local file check if URL fails
        }
        
        // Handle local file thumbnails
        if (thumbnailPath && fs.existsSync(thumbnailPath)) {
            return fs.readFileSync(thumbnailPath);
        }
        
        // Return fallback 1x1 transparent pixel
        return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    } catch (error) {
        console.error('Error loading thumbnail:', error.message);
        // Return fallback buffer
        return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    }
}

// Create fake contact for enhanced replies
function createFakeContact(message) {
    return {
        key: {
            participants: "0@s.whatsapp.net",
            remoteJid: "status@broadcast",
            fromMe: false,
            id: "JUNE-X-MENU"
        },
        message: {
            contactMessage: {
                vcard: `BEGIN:VCARD\nVERSION:3.0\nN:Sy;Bot;;;\nFN:JUNE X\nitem1.TEL;waid=${message.key.participant?.split('@')[0] || message.key.remoteJid.split('@')[0]}:${message.key.participant?.split('@')[0] || message.key.remoteJid.split('@')[0]}\nitem1.X-ABLabel:Ponsel\nEND:VCARD`
            }
        },
        participant: "0@s.whatsapp.net"
    };
}

// JUNE-X BOT menu style function (restored original branding)
async function sendMenuWithStyle(sock, chatId, message, menulist, menustyle, thumbnailBuffer, pushname) {
    const fkontak = createFakeContact(message);
    const botname = setBotNameCommand();
    const ownername = pushname;
    const tylorkids = thumbnailBuffer;
    const plink = "https://github.com/vinpink2";
    
    if (menustyle === '1') {
        await sock.sendMessage(chatId, {
            document: {
                url: "https://i.ibb.co/2W0H9Jq/avatar-contact.png",
            },
            caption: menulist,
            mimetype: "application/zip",
            fileName: `${botname}`,
            fileLength: "9999999",
            contextInfo: {
                externalAdReply: {
                    showAdAttribution: false,
                    title: "",
                    body: "",
                    thumbnail: tylorkids,
                    sourceUrl: plink,
                    mediaType: 1,
                    renderLargerThumbnail: true,
                },
            },
        }, { quoted: fkontak });
    } else if (menustyle === '2') {
        await sock.sendMessage(chatId, { 
            text: menulist 
        }, { quoted: fkontak });
    } else if (menustyle === '3') {
        await sock.sendMessage(chatId, {
            text: menulist,
            contextInfo: {
                externalAdReply: {
                    showAdAttribution: false,
                    title: botname,
                    body: ownername,
                    thumbnail: tylorkids,
                    sourceUrl: plink,
                    mediaType: 1,
                    renderLargerThumbnail: true,
                },
            },
        }, { quoted: fkontak });
    } else if (menustyle === '4') {
        await sock.sendMessage(chatId, {
            image: tylorkids,
            caption: menulist,
        }, { quoted: fkontak });
    } else if (menustyle === '5') {
        let massage = generateWAMessageFromContent(chatId, {
            viewOnceMessage: {
                message: {
                    interactiveMessage: {
                        body: {
                            text: null,            
                        },
                        footer: {
                            text: menulist, 
                        },
                        nativeFlowMessage: {
                            buttons: [{
                                text: null
                            }], 
                        },
                    },
                },
            },
        }, { quoted: fkontak });
        await sock.relayMessage(chatId, massage.message, { messageId: massage.key.id });
    } else if (menustyle === '6') {
        await sock.relayMessage(chatId, {
            requestPaymentMessage: {
                currencyCodeIso4217: 'USD',
                requestFrom: '0@s.whatsapp.net',
                amount1000: '1',
                noteMessage: {
                    extendedTextMessage: {
                        text: menulist,
                        contextInfo: {
                            mentionedJid: [message.key.participant || message.key.remoteJid],
                            externalAdReply: {
                                showAdAttribution: false,
                            },
                        },
                    },
                },
            },
        }, {});
    } else {
        // Default fallback
        await sock.sendMessage(chatId, { 
            text: menulist 
        }, { quoted: fkontak });
    }
}

// Main help command function
async function helpCommand(sock, chatId, message) {
    const pushname = message.pushName || "Unknown User"; 
    const menuStyle = getMenuStyle();

    console.log('Current menu style:', menuStyle);

    let data = JSON.parse(fs.readFileSync('./data/messageCount.json'));
    
    // Create fake contact for enhanced reply
    const fkontak = createFakeContact(message);
    
    const start = Date.now();
    await sock.sendMessage(chatId, { 
        text: '_Wait loading Menu..._' 
    }, { quoted: fkontak });
    const end = Date.now();
    const ping = Math.round((end - start) / 2);

    const uptimeInSeconds = process.uptime();
    const uptimeFormatted = formatTime(uptimeInSeconds);
    const currentMode = data.mode || data.isPublic ? 'public' : 'private';
    const hostName = detectPlatform();
    
    const menulist = generateMenu(pushname, currentMode, hostName, ping, uptimeFormatted);

    // Get custom menu image from settings
    const { getMenuImage } = require('../lib/botConfig');
    const customMenuImage = getMenuImage();
    let thumbnailPath;
    
    if (customMenuImage) {
        thumbnailPath = customMenuImage; // Can be URL or local path
    } else {
        // Random thumbnail selection from local files
        const thumbnailFiles = [
            'menu1.jpg',
            'menu2.jpg', 
            'menu3.jpg',
            'menu4.jpg',
            'menu5.jpg'
        ];
        const randomThumbFile = thumbnailFiles[Math.floor(Math.random() * thumbnailFiles.length)];
        thumbnailPath = path.join(__dirname, '../assets', randomThumbFile);
    }

    // Send reaction
    await sock.sendMessage(chatId, {
        react: { text: '🗝️', key: message.key }
    });

    try {
        // Load thumbnail using helper function
        const thumbnailBuffer = await loadThumbnail(thumbnailPath);

        // Send menu using JUNE-X BOT menu style function
        await sendMenuWithStyle(sock, chatId, message, menulist, menuStyle, thumbnailBuffer, pushname);

        // Success reaction
        await sock.sendMessage(chatId, {
            react: { text: '⚧️', key: message.key }
        });

    } catch (error) {
        console.error('Error in help command:', error);
        // Fallback to simple text
        try {
            await sock.sendMessage(chatId, { 
                text: menulist 
            }, { quoted: fkontak });
        } catch (fallbackError) {
            console.error('Even fallback failed:', fallbackError);
        }
    }
}

module.exports = helpCommand;
