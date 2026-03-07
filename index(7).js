console.clear();
console.log('Starting Jexploit with much love from Kelvin Tech...');

const settings = require('./settings');
const config = require('./config');

const {
  default: makeWASocket,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  generateForwardMessageContent,
  generateWAMessageFromContent,
  downloadContentFromMessage,
  getContentType,
  jidDecode,
  proto,
  browsers,
  delay
} = require("@whiskeysockets/baileys");

const pino = require('pino');
const readline = require("readline");
const fs = require('fs');
const os = require('os');
const path = require('path')
const more = String.fromCharCode(8206);
const chalk = require('chalk');
const _ = require('lodash');
const NodeCache = require("node-cache");
const lolcatjs = require('lolcatjs');
const readmore = more.repeat(4001);
const util = require('util');
const axios = require('axios');
const fetch = require('node-fetch');
const timezones = global.timezones || "Africa/Kampala";
const moment = require('moment-timezone');
const FileType = require('file-type');
const { Boom } = require('@hapi/boom');
const PhoneNumber = require('awesome-phonenumber');
const { File } = require('megajs');
const port = process.env.PORT || 3000;
const express = require('express')
const app = express();
const { color } = require('./start/lib/color');
const {
  smsg,
  sendGmail,
  formatSize,
  isUrl,
  generateMessageTag,
  getBuffer,
  getSizeMedia,
  runtime,
  fetchJson,
} = require('./start/lib/myfunction');

const {
detectUrls,
handleAntidemote,
handleAntipromote,
handleStatusUpdate
 } = require('./Jex');

const {
  imageToWebp,
  videoToWebp,
  writeExifImg,
  writeExifVid
} = require('./start/lib/exif');

const { cleaningSession } = require('./start/lib/botSession');
const db = require('./start/Core/databaseManager'); 

const usePairingCode = true;

const question = (text) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(text, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

const yargs = require('yargs/yargs');

//=========SESSION-AUTH=====================
const sessionDir = path.join(__dirname, 'sessions');
const credsPath = path.join(sessionDir, 'creds.json');

// Create session directory if it doesn't exist
if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
}

// Create tmp directory if it doesn't exist
const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
}

// ============= 🔥 IMPROVED SESSION CLEANUP FUNCTION =============
function cleanOldSessionFiles() {
    try {
        if (!fs.existsSync(sessionDir)) return;
        
        const files = fs.readdirSync(sessionDir);
        const now = Date.now();
        const protectedFiles = new Set(['creds.json', 'login.json']);
        
        // More aggressive cleanup with different timeouts for different file types
        const maxAge = {
            'pre-key-': 1 * 60 * 60 * 1000,        // 1 hour
            'sender-key-': 3 * 60 * 60 * 1000,      // 3 hours
            'session-': 6 * 60 * 60 * 1000,          // 6 hours
            'app-state-sync-': 2 * 60 * 60 * 1000,   // 2 hours
            'device-list-': 1 * 60 * 60 * 1000       // 1 hour
        };

        let cleaned = 0;
        
        files.forEach(file => {
            if (protectedFiles.has(file)) return;
            
            try {
                const stats = fs.statSync(path.join(sessionDir, file));
                const age = now - stats.mtimeMs;
                
                // Determine max age for this file type
                let fileMaxAge = 12 * 60 * 60 * 1000; // Default 12 hours
                
                for (const [pattern, ageLimit] of Object.entries(maxAge)) {
                    if (file.startsWith(pattern)) {
                        fileMaxAge = ageLimit;
                        break;
                    }
                }
                
                if (age > fileMaxAge) {
                    fs.unlinkSync(path.join(sessionDir, file));
                    cleaned++;
                }
            } catch (err) {
                // If file can't be accessed, delete it
                try {
                    fs.unlinkSync(path.join(sessionDir, file));
                    cleaned++;
                } catch {}
            }
        });
        
        if (cleaned > 0) {
            console.log(chalk.green(`[Session Cleanup] ✅ Removed ${cleaned} stale session files`));
        }
        
        // Also clean tmp folder
        if (fs.existsSync(tmpDir)) {
            const tmpFiles = fs.readdirSync(tmpDir);
            let tmpCleaned = 0;
            tmpFiles.forEach(file => {
                try {
                    const filePath = path.join(tmpDir, file);
                    const stats = fs.statSync(filePath);
                    const age = now - stats.mtimeMs;
                    
                    // Delete tmp files older than 1 hour
                    if (age > 60 * 60 * 1000) {
                        fs.unlinkSync(filePath);
                        tmpCleaned++;
                    }
                } catch {}
            });
            if (tmpCleaned > 0) {
                console.log(chalk.green(`[Temp Cleanup] ✅ Removed ${tmpCleaned} old temp files`));
            }
        }
        
    } catch (error) {
        console.error(chalk.red('[SESSION CLEANUP] ❌ Error:'), error.message);
    }
}

// ============= 🔥 SESSION VALIDATION FUNCTION =============
async function validateSession() {
    try {
        if (fs.existsSync(credsPath)) {
            const credsData = fs.readFileSync(credsPath, 'utf8');
            
            // Check if file is empty
            if (!credsData || credsData.trim() === '') {
                console.log(chalk.yellow('[SESSION] Credentials file is empty, backing up...'));
                fs.renameSync(credsPath, credsPath + '.empty.backup');
                return false;
            }
            
            try {
                const creds = JSON.parse(credsData);
                
                // Check if creds are corrupted or missing required fields
                if (!creds || !creds.me || !creds.me.id) {
                    console.log(chalk.yellow('[SESSION] Credentials corrupted, backing up...'));
                    fs.renameSync(credsPath, credsPath + '.corrupted.backup');
                    
                    // Remove other session files but keep backup
                    const files = fs.readdirSync(sessionDir);
                    files.forEach(file => {
                        if (file !== 'creds.json.corrupted.backup' && file !== 'creds.json.empty.backup') {
                            try { fs.unlinkSync(path.join(sessionDir, file)); } catch {}
                        }
                    });
                    return false;
                }
                
                console.log(chalk.green('[SESSION] ✅ Credentials valid'));
                return true;
            } catch (parseErr) {
                console.log(chalk.yellow('[SESSION] Credentials JSON corrupted, backing up...'));
                fs.renameSync(credsPath, credsPath + '.parse.error.backup');
                
                // Remove other session files
                const files = fs.readdirSync(sessionDir);
                files.forEach(file => {
                    if (!file.includes('.backup')) {
                        try { fs.unlinkSync(path.join(sessionDir, file)); } catch {}
                    }
                });
                return false;
            }
        }
        return false;
    } catch (err) {
        console.log(chalk.yellow('[SESSION] Error validating session:'), err.message);
        return false;
    }
}

// Run session cleanup immediately and every 30 minutes
cleanOldSessionFiles();
setInterval(cleanOldSessionFiles, 30 * 60 * 1000); // 30 minutes

async function loadSession() {
    try {
        if (!settings.SESSION_ID) {
            console.log('No SESSION_ID provided - QR login will be generated');
            return null;
        }

        console.log('[⏳] Downloading creds data...');
        console.log('[🔰] Downloading MEGA.nz session...');

        const megaFileId = settings.SESSION_ID.startsWith('jexploit~') 
            ? settings.SESSION_ID.replace("jexploit~", "") 
            : settings.SESSION_ID;

        const filer = File.fromURL(`https://mega.nz/file/${megaFileId}`);

        const data = await new Promise((resolve, reject) => {
            filer.download((err, data) => {
                if (err) reject(err);
                else resolve(data);
            });
        });

        fs.writeFileSync(credsPath, data);
        console.log('[✅] MEGA session downloaded successfully');
        return JSON.parse(data.toString());
    } catch (error) {
        console.error('❌ Error loading session:', error.message);
        console.log('Will generate QR code instead');
        return null;
    }
}

const storeFile = "./start/lib/database/store.json";
const maxMessageAge = 24 * 60 * 60; //24 hours

function loadStoredMessages() {
    if (fs.existsSync(storeFile)) {
        try {
            return JSON.parse(fs.readFileSync(storeFile));
        } catch (err) {
            console.error("⚠️ Error loading store.json:", err);
            return {};
        }
    }
    return {};
}

function saveStoredMessages(chatId, messageId, messageData) {
    let storedMessages = loadStoredMessages();

    if (!storedMessages[chatId]) storedMessages[chatId] = {};
    if (!storedMessages[chatId][messageId]) {
        storedMessages[chatId][messageId] = messageData;
        fs.writeFileSync(storeFile, JSON.stringify(storedMessages, null, 2));
    }
}

function cleanupOldMessages() {
    let now = Math.floor(Date.now() / 1000);
    let storedMessages = {};

    if (fs.existsSync(storeFile)) {
        try {
            storedMessages = JSON.parse(fs.readFileSync(storeFile));
        } catch (err) {
            console.error("❌ Error reading store.json:", err);
            return;
        }
    }

    let totalMessages = 0, oldMessages = 0, keptMessages = 0;

    for (let chatId in storedMessages) {
        let messages = storedMessages[chatId];

        for (let messageId in messages) {
            let messageTimestamp = messages[messageId].timestamp;

            if (typeof messageTimestamp === "object" && messageTimestamp.low !== undefined) {
                messageTimestamp = messageTimestamp.low;
            }

            if (messageTimestamp > 1e12) {
                messageTimestamp = Math.floor(messageTimestamp / 1000);
            }

            totalMessages++;

            if (now - messageTimestamp > maxMessageAge) {
                delete storedMessages[chatId][messageId];
                oldMessages++;
            } else {
                keptMessages++;
            }
        }
        
        if (Object.keys(storedMessages[chatId]).length === 0) {
            delete storedMessages[chatId];
        }
    }

    fs.writeFileSync(storeFile, JSON.stringify(storedMessages, null, 2));
}

function startAutoCleanup() {
    setInterval(() => {
        cleanupOldMessages();
    }, 15 * 60 * 1000);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============= 🔥 AUTO-RECONNECT VARIABLES =============
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 15;
let reconnectTimeout = null;

// ============= 🔥 RECONNECT FUNCTION WITH BACKOFF =============
async function reconnectWithBackoff() {
    // Clear any existing reconnect timeout
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.log(chalk.red('[RECONNECT] ❌ Max attempts reached. Please restart manually.'));
        console.log(chalk.yellow('[RECONNECT] Will retry in 5 minutes...'));
        
        // Reset attempts after 5 minutes
        reconnectTimeout = setTimeout(() => {
            reconnectAttempts = 0;
            console.log(chalk.green('[RECONNECT] Reset reconnect attempts, trying again...'));
            clientstart();
        }, 5 * 60 * 1000);
        
        return;
    }
    
    const backoffTime = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 30000); // Max 30 seconds
    reconnectAttempts++;
    
    console.log(chalk.yellow(`[RECONNECT] Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${backoffTime/1000}s`));
    
    await sleep(backoffTime);
    
    // Clean sessions before reconnecting
    cleanOldSessionFiles();
    
    // Restart client
    try {
        await clientstart();
        reconnectAttempts = 0; // Reset on successful connection
        console.log(chalk.green('[RECONNECT] ✅ Successfully reconnected!'));
    } catch (err) {
        console.log(chalk.red('[RECONNECT] ❌ Failed:'), err.message);
        reconnectWithBackoff(); // Try again with backoff
    }
}

async function clientstart() {
    try {
        // Validate session before starting
        await validateSession();
        
        console.log(chalk.cyan.bold('[🧹] Cleaning old session files...'));
        cleaningSession(sessionDir);
        
        const creds = await loadSession();
        await cleanupOldMessages();
        startAutoCleanup();
        
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
       
        let waVersion;
        try {
            const { version } = await fetchLatestBaileysVersion();
            waVersion = version;
            console.log("[ JEXPLOIT] Connecting to WhatsApp ⏳️...");
        } catch (error) {
            console.log(chalk.yellow(`[⚠️] Using stable fallback version`));
            waVersion = [2, 3000, 1017546695];
        }

        const conn = makeWASocket({
            printQRInTerminal: !usePairingCode,
            syncFullHistory: false,
            markOnlineOnConnect: true,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 30000,
            keepAliveIntervalMs: 25000,
            maxRetries: 10,
            retryCount: 3,
            generateHighQualityLinkPreview: false,
            linkPreviewImageThumbnailWidth: 64,
            shouldSyncHistoryMessage: false,
            version: waVersion,
            browser: ["Jexploit", "Chrome", "120.0.0.0"],
            logger: pino({ level: 'silent' }),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino().child({
                    level: 'silent',
                    stream: 'store'
                })),
            },
            fireInitQueries: false, 
            emitOwnEvents: true,
            defaultCongestionControl: 1,
            patchMessageBeforeSending: (msg) => {
                return msg;
            },
        });

        // ============= 🔥 IMPROVED KEEP-ALIVE =============
        const keepAliveInterval = 3 * 60 * 1000; // 3 minutes
        let lastPingSuccess = true;
        let pingInterval = null;

        function startKeepAlive() {
            if (pingInterval) clearInterval(pingInterval);
            
            pingInterval = setInterval(async () => {
                try {
                    if (conn?.user?.id && conn?.ws?.readyState === 1) { // WebSocket.OPEN = 1
                        await conn.sendPresenceUpdate('available');
                        if (!lastPingSuccess) {
                            console.log(chalk.green('[Keep-Alive] ✅ Connection restored'));
                        }
                        lastPingSuccess = true;
                    } else {
                        console.log(chalk.yellow('[Keep-Alive] ⚠️ Connection not ready'));
                        lastPingSuccess = false;
                        
                        // Check if connection is really dead
                        if (conn?.ws?.readyState === 3) { // CLOSED
                            console.log(chalk.red('[Keep-Alive] ❌ WebSocket closed, triggering reconnect...'));
                            clearInterval(pingInterval);
                            reconnectWithBackoff();
                        }
                    }
                } catch (e) {
                    console.log(chalk.red('[Keep-Alive] ❌ Failed:'), e.message);
                    lastPingSuccess = false;
                }
            }, keepAliveInterval);
        }

        startKeepAlive();

        conn.decodeJid = (jid) => {
            if (!jid) return jid;
            if (/:\d+@/gi.test(jid)) {
                let decode = jidDecode(jid) || {};
                return decode.user && decode.server && decode.user + '@' + decode.server || jid;
            } else return jid;
        };

        const botNumber = conn.decodeJid(conn.user?.id) || 'default';

        if (!creds && !conn.authState.creds.registered) {
            const phoneNumber = await question(chalk.greenBright(`Thanks for choosing Jexploit-bot. Please provide your number start with 256xxx:\n`));
            const code = await conn.requestPairingCode(phoneNumber.trim());
            console.log(chalk.cyan(`Code: ${code}`));
            console.log(chalk.cyan(`Jexploit: Please use this code to connect your WhatsApp account.`));
        }
              
        const { makeInMemoryStore } = require("./start/lib/store/");
        const store = makeInMemoryStore({
            logger: pino().child({
                level: 'silent',
                stream: 'store'
            })
        });
        
        store.bind(conn.ev);

        conn.ev.on('messages.upsert', async chatUpdate => {
            try {
                let mek = chatUpdate.messages[0];
                if (!mek.message) return;
                mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message;
            
                await handleStatusUpdate(conn, chatUpdate);
                
                if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                    return;
                }

                if (!conn.public && !mek.key.fromMe && chatUpdate.type === 'notify') return;
                let m = smsg(conn, mek, store);
               
                m.isGroup = m.chat.endsWith('@g.us')
                m.sender = await conn.decodeJid(m.fromMe && conn.user.id || m.participant || m.key.participant || m.chat || '')
                
                if (m.isGroup) {
                    m.metadata = await conn.groupMetadata(m.chat).catch(_ => ({})) || {}
                    const admins = []
                    if (m.metadata?.participants) {
                        for (let p of m.metadata.participants) {
                            if (p.admin !== null) {
                                if (p.jid) admins.push(p.jid)
                                if (p.id) admins.push(p.id)
                                if (p.lid) admins.push(p.lid)
                            }
                        }
                    }
                    m.admins = admins
                    
                    const checkAdmin = (jid, list) =>
                        list.some(x =>
                            x === jid ||
                            (jid.endsWith('@s.whatsapp.net') && x === jid.replace('@s.whatsapp.net', '@lid')) ||
                            (jid.endsWith('@lid') && x === jid.replace('@lid', '@s.whatsapp.net'))
                        )
                    
                    m.isAdmin = checkAdmin(m.sender, m.admins)
                    m.isBotAdmin = checkAdmin(botNumber, m.admins)
                    m.participant = m.key.participant || ""
                } else {
                    m.isAdmin = false
                    m.isBotAdmin = false
                }
          
                require("./start/kevin")(conn, m, chatUpdate, mek, store);
            } catch (err) {
                console.log(chalk.yellow.bold("[ ERROR ] kevin.js :\n") + chalk.redBright(util.format(err)));
            }
        });

        conn.ev.on('contacts.update', update => {
            for (let contact of update) {
                let id = conn.decodeJid(contact.id);
                if (store && store.contacts) store.contacts[id] = { id, name: contact.notify };
            }
        });

        // ============= 🔥 IMPROVED CONNECTION HANDLER =============
        conn.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const errorMessage = lastDisconnect?.error?.message || 'Unknown error';
                const boomError = lastDisconnect?.error instanceof Boom ? lastDisconnect.error : null;
                
                console.log(chalk.red(`[CONNECTION] ❌ Closed with status code: ${statusCode}`));
                console.log(chalk.red(`[CONNECTION] Error: ${errorMessage}`));
                
                // Clear keep-alive interval
                if (pingInterval) {
                    clearInterval(pingInterval);
                    pingInterval = null;
                }
                
                // Check if it's a logout or just a normal disconnect
                const isLogout = statusCode === 401 || (boomError && boomError.message.includes('logged out'));
                const shouldReconnect = !isLogout;
                
                if (shouldReconnect) {
                    console.log(chalk.yellow('[CONNECTION] Attempting to reconnect...'));
                    
                    // Clean session files before reconnecting
                    cleanOldSessionFiles();
                    
                    // Use exponential backoff for reconnection
                    reconnectWithBackoff();
                } else {
                    console.log(chalk.red('[CONNECTION] ❌ Logged out. Please scan QR code again.'));
                    
                    // Remove corrupted session files
                    const files = fs.readdirSync(sessionDir);
                    files.forEach(file => {
                        if (file !== 'creds.json.backup') {
                            try { fs.unlinkSync(path.join(sessionDir, file)); } catch {}
                        }
                    });
                    
                    // Restart for new QR
                    reconnectAttempts = 0;
                    await sleep(5000);
                    clientstart();
                }
            }
            
            if (connection === 'open') {
                console.log(chalk.green('[CONNECTION] ✅ Connected successfully!'));
                console.log(chalk.green(`[CONNECTION] Logged in as: ${conn.user?.name || conn.user?.id || 'Unknown'}`));
                
                // Reset reconnect attempts on successful connection
                reconnectAttempts = 0;
                
                // Restart keep-alive
                startKeepAlive();
            }
            
            if (qr) {
                console.log(chalk.yellow('[CONNECTION] QR Code received - please scan'));
            }
        });

        conn.ev.on('group-participants.update', async (anu) => {
        try {
            const botNumber = conn.decodeJid(conn.user.id);
            const groupId = anu.id;
            
            // Get settings
            const admineventEnabled = await db.get(botNumber, 'adminevent', false);
            const welcomeEnabled = await db.isWelcomeEnabled(botNumber, groupId);
            
            // ========== HANDLE ANTIDEMOTE ==========
            if (anu.action === 'demote') {
                await handleAntidemote(conn, groupId, anu.participants, anu.author);
            }
            
            if (anu.action === 'promote') {
                await handleAntipromote(conn, groupId, anu.participants, anu.author);
            }
            
            if (welcomeEnabled === true) {
                console.log(`[WELCOME] Processing welcome/goodbye for group ${groupId}`);
                
                try {
                    const groupMetadata = await conn.groupMetadata(groupId);
                    const participants = anu.participants;
                    
                    for (const participant of participants) {
                        
                        let participantJid;
                        if (typeof participant === 'string') {
                            participantJid = participant;
                        } else if (participant && participant.id) {
                            participantJid = participant.id;
                        } else {
                            console.error('[WELCOME] Invalid participant format:', participant);
                            continue;
                        }
                        
                        if (participantJid === botNumber) continue;
                        
                        let userId;
                        if (participantJid.includes('@')) {
                            userId = participantJid.split('@')[0];
                        } else {
                            userId = participantJid;
                        }
                        
                        let ppUrl;
                        try {
                            ppUrl = await conn.profilePictureUrl(participantJid, 'image');
                        } catch {
                            ppUrl = 'https://i.ibb.co/RBx5SQC/avatar-group-large-v2.png?q=60';
                        }
                        
                        const name = await conn.getName(participantJid) || userId;
                        
                        if (anu.action === 'add') {
                            const memberCount = groupMetadata.participants.length;
                            await conn.sendMessage(groupId, {
                                image: { url: ppUrl },
                                caption: `
*${global.botname} welcome* @${userId}  

*𝙶𝚛𝚘𝚞𝚙 𝙽𝚊𝚖𝚎: ${groupMetadata.subject}*

*You're our ${memberCount}th member!*

*Join time: ${moment.tz(timezones).format('HH:mm:ss')}, ${moment.tz(timezones).format('DD/MM/YYYY')}*

𝙲𝚊𝚞𝚜𝚎 𝚌𝚑𝚊𝚘𝚜 𝚒𝚝𝚜 𝚊𝚕𝚠𝚊𝚢𝚜 𝚏𝚞𝚗

> ${global.wm}`,
                                mentions: [participantJid]
                            });
                            console.log(`✅ Welcome message sent for ${name} in ${groupMetadata.subject}`);
                            
                        } else if (anu.action === 'remove') {
                            const memberCount = groupMetadata.participants.length;
                            await conn.sendMessage(groupId, {
                                image: { url: ppUrl },
                                caption: `
*👋 Goodbye* 😪 @${userId}

*Left at: ${moment.tz(timezones).format('HH:mm:ss')}, ${moment.tz(timezones).format('DD/MM/YYYY')}*

*We're now ${memberCount} members*.

> ${global.wm}`,
                                mentions: [participantJid]
                            });
                            console.log(`✅ Goodbye message sent for ${name} in ${groupMetadata.subject}`);
                        }
                    }
                } catch (err) {
                    console.error('Error in welcome feature:', err);
                }
            }
            
            // ========== HANDLE ADMIN EVENTS ==========
            if (admineventEnabled === true) {
                const participantJids = anu.participants.map(p => 
                    typeof p === 'string' ? p : (p?.id || '')
                ).filter(p => p);
                
                if (participantJids.includes(botNumber)) return;
                
                try {
                    let metadata = await conn.groupMetadata(anu.id);
                    let participants = anu.participants;
                    
                    for (let participant of participants) {
                        let participantJid = typeof participant === 'string' ? participant : participant?.id;
                        if (!participantJid) continue;
                        
                        let authorJid = anu.author;
                        if (anu.author && typeof anu.author !== 'string' && anu.author.id) {
                            authorJid = anu.author.id;
                        }
                        
                        let check = authorJid && authorJid !== participantJid;
                        let tag = check ? [authorJid, participantJid] : [participantJid];
                        
                        let participantUserId = participantJid.includes('@') ? 
                            participantJid.split('@')[0] : participantJid;
                        let authorUserId = authorJid && authorJid.includes('@') ? 
                            authorJid.split('@')[0] : authorJid;
                        
                        if (anu.action == "promote") {
                            let promotedUsers = [];
                            for (let participant of participants) {
                                let pJid = typeof participant === 'string' ? participant : participant?.id;
                                if (!pJid) continue;
                                let userId = pJid.includes('@') ? pJid.split('@')[0] : pJid;
                                promotedUsers.push(`@${userId}`);
                            }
                            
                            const promotionMessage = `*『 GROUP PROMOTION 』*\n\n` +
                                `👤 *Promoted User${participants.length > 1 ? 's' : ''}:*\n` +
                                `${promotedUsers.join('\n')}\n\n` +
                                `👑 *Promoted By:* @${authorUserId || 'Unknown'}\n\n` +
                                `📅 *Date:* ${new Date().toLocaleString()}`;
                            
                            await conn.sendMessage(anu.id, {
                                text: promotionMessage,
                                mentions: tag
                            });
                        }
                        
                        if (anu.action == "demote") {
                            let demotedUsers = [];
                            for (let participant of participants) {
                                let pJid = typeof participant === 'string' ? participant : participant?.id;
                                if (!pJid) continue;
                                let userId = pJid.includes('@') ? pJid.split('@')[0] : pJid;
                                demotedUsers.push(`@${userId}`);
                            }
                            
                            const demotionMessage = `*『 GROUP DEMOTION 』*\n\n` +
                                `👤 *Demoted User${participants.length > 1 ? 's' : ''}:*\n` +
                                `${demotedUsers.join('\n')}\n\n` +
                                `👑 *Demoted By:* @${authorUserId || 'Unknown'}\n\n` +
                                `📅 *Date:* ${new Date().toLocaleString()}`;
                            
                            await conn.sendMessage(anu.id, {
                                text: demotionMessage,
                                mentions: tag
                            });
                        }
                    }
                } catch (err) {
                    console.log('Error in admin event feature:', err);
                }
            }
            
        } catch (error) {
            console.error('Error in group-participants.update:', error);
        }
    });
            
        conn.ev.on('call', async (callData) => {
        try {
            const botNumber = await conn.decodeJid(conn.user.id);
            
            // GET ANTICALL SETTING FROM SQLITE
            const anticallSetting = await db.get(botNumber, 'anticall', 'off');
            
            if (!anticallSetting || anticallSetting === 'off') {
                console.log(chalk.gray('[ANTICALL] Disabled'));
                return;
            }
            
            for (let call of callData) {
                const from = call.from;
                const callId = call.id;
                
                // Get owners from database
                const owners = await db.get(botNumber, 'owners', []);
                const isOwner = owners.some(num => from.includes(num.replace('+', '').replace(/[^0-9]/g, '')));
                
                if (isOwner) {
                    console.log(chalk.green(`[ANTICALL] Allowing call from owner: ${from}`));
                    continue;
                }
                
                try {
                    const now = Date.now();
                    const lastWarn = global.recentCallers?.get(from) || 0;
                    const COOLDOWN = 30 * 1000;
                    
                    if (now - lastWarn < COOLDOWN) {
                        console.log(chalk.yellow(`[ANTICALL] Suppressing repeated warning to ${from}`));
                        try {
                            if (typeof conn.rejectCall === 'function') {
                                await conn.rejectCall(callId, from);
                            }
                        } catch (e) {}
                        continue;
                    }
                    
                    if (!global.recentCallers) global.recentCallers = new Map();
                    global.recentCallers.set(from, now);
                    
                    setTimeout(() => {
                        if (global.recentCallers?.has(from)) {
                            global.recentCallers.delete(from);
                        }
                    }, COOLDOWN);
                    
                } catch (e) {
                    console.error(chalk.red('[ANTICALL] recentCallers check failed:'), e);
                    if (!global.recentCallers) global.recentCallers = new Map();
                }
                
                console.log(chalk.yellow(`[ANTICALL] ${anticallSetting} call from: ${from}`));
                
                try {
                    const callerName = await conn.getName(from) || from.split('@')[0];
                    let warningMessage = '';
                    
                    if (anticallSetting === 'block') {
                        warningMessage = `🚫 *CALL BLOCKED*\n\n` +
                            `*Caller:* @${from.split('@')[0]}\n` +
                            `*Time:* ${moment().tz(timezones).format('HH:mm:ss')}\n` +
                            `*Date:* ${moment().tz(timezones).format('DD/MM/YYYY')}\n\n` +
                            `*🌹 Hi, I am ${global.botname}, a friendly WhatsApp bot from Uganda 🇺🇬, created by Kelvin Tech.*\n\n` +
                            `*My owner cannot receive calls at this moment. Calls are automatically blocked.*\n\n` +
                            `> ${global.wm}`;
                    } else {
                        warningMessage = `🚫 *CALL DECLINED*\n\n` +
                            `*Caller:* @${from.split('@')[0]}\n` +
                            `*Time:* ${moment().tz(timezones).format('HH:mm:ss')}\n` +
                            `*Date:* ${moment().tz(timezones).format('DD/MM/YYYY')}\n\n` +
                            `*🌹 Hi, I am ${global.botname}, a friendly WhatsApp bot from Uganda 🇺🇬, created by Kelvin Tech.*\n\n` +
                            `*My owner cannot receive calls at this moment. Please avoid unnecessary calling.*\n\n` +
                            `> ${global.wm}`;
                    }

                    await conn.sendMessage(from, { 
                        text: warningMessage,
                        mentions: [from]
                    });
                    
                    console.log(chalk.green(`[ANTICALL] Warning message sent to chat: ${from}`));
                    
                } catch (msgError) {
                    console.error(chalk.red('[ANTICALL] Failed to send message to chat:'), msgError);
                }
                
                try {
                    if (typeof conn.rejectCall === 'function') {
                        await conn.rejectCall(callId, from);
                        console.log(chalk.green(`[ANTICALL] Successfully ${anticallSetting === 'block' ? 'blocked' : 'declined'} call from: ${from}`));
                        
                        if (anticallSetting === 'block') {
                            try {
                                await conn.updateBlockStatus(from, 'block');
                                console.log(chalk.red(`[ANTICALL] Blocked user: ${from}`));
                            } catch (blockError) {
                                console.error(chalk.red('[ANTICALL] Failed to block user:'), blockError);
                            }
                        }
                    } else {
                        console.log(chalk.yellow('[ANTICALL] conn.rejectCall not available'));
                    }
                } catch (rejectError) {
                    console.error(chalk.red('[ANTICALL] Failed to decline/block call:'), rejectError);
                }
            }
        } catch (error) {
            console.error(chalk.red('[ANTICALL ERROR]'), error);
        }
    });

        conn.sendTextWithMentions = async (jid, text, quoted, options = {}) => {
            const mentionedJid = [...text.matchAll(/@(\d{0,16})/g)].map(
                (v) => v[1] + "@s.whatsapp.net",
            );
            return conn.sendMessage(jid, {
                text: text,
                contextInfo: {
                    mentionedJid: mentionedJid,
                },
                ...options,
            }, { quoted });
        };

        conn.sendImageAsSticker = async (jid, path, quoted, options = {}) => {
            let buff;
            try {
                buff = Buffer.isBuffer(path)
                    ? path
                    : /^data:.*?\/.*?;base64,/i.test(path)
                    ? Buffer.from(path.split`,`[1], 'base64')
                    : /^https?:\/\//.test(path)
                    ? await (await getBuffer(path))
                    : fs.existsSync(path)
                    ? fs.readFileSync(path)
                    : Buffer.alloc(0);
            } catch (e) {
                console.error('Error getting buffer:', e);
                buff = Buffer.alloc(0);
            }

            let buffer;
            if (options && (options.packname || options.author)) {
                buffer = await writeExifImg(buff, options);
            } else {
                buffer = await imageToWebp(buff);
            }

            await conn.sendMessage(jid, { sticker: { url: buffer }, ...options }, { quoted });
            return buffer;
        };

        conn.sendVideoAsSticker = async (jid, path, quoted, options = {}) => {
            let buff;
            try {
                buff = Buffer.isBuffer(path)
                    ? path
                    : /^data:.*?\/.*?;base64,/i.test(path)
                    ? Buffer.from(path.split`,`[1], 'base64')
                    : /^https?:\/\//.test(path)
                    ? await (await getBuffer(path))
                    : fs.existsSync(path)
                    ? fs.readFileSync(path)
                    : Buffer.alloc(0);
            } catch (e) {
                console.error('Error getting buffer:', e);
                buff = Buffer.alloc(0);
            }

            let buffer;
            if (options && (options.packname || options.author)) {
                buffer = await writeExifVid(buff, options);
            } else {
                buffer = await videoToWebp(buff);
            }

            await conn.sendMessage(jid, { sticker: { url: buffer }, ...options }, { quoted });
            return buffer;
        };

        conn.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
            let quoted = message.msg ? message.msg : message;
            let mime = (message.msg || message).mimetype || "";
            let messageType = message.mtype
                ? message.mtype.replace(/Message/gi, "")
                : mime.split("/")[0];

            const stream = await downloadContentFromMessage(quoted, messageType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            let type = await FileType.fromBuffer(buffer);
            let trueFileName = attachExtension ? (filename + "." + (type ? type.ext : 'bin')) : filename;
            let savePath = path.join(tmpDir, trueFileName);
            await fs.writeFileSync(savePath, buffer);
            return savePath;
        };

        conn.getName = async (id, withoutContact = false) => {
            let v;
            if (id.endsWith('@g.us')) {
            } else {
                v = store.contacts[id] || {};
                return v.name || v.notify || v.verifiedName || id.split('@')[0];
            }
        };

        conn.sendContact = async (jid, kon, quoted = '', opts = {}) => {
            let list = [];
            for (let i of kon) {
                const name = await conn.getName(i);
                list.push({
                    displayName: name,
                    vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${name}\nFN:${name}\nitem1.TEL;waid=${i}:${i}\nitem1.X-ABLabel:jangan spam bang\nitem2.EMAIL;type=INTERNET:Zuurzyen\nitem2.X-ABLabel:YouTube\nitem3.URL:Zuuryzen.tech\nitem3.X-ABLabel:GitHub\nitem4.ADR:;;Indonesia;;;;\nitem4.X-ABLabel:Region\nEND:VCARD`
                });
            }
            conn.sendMessage(jid, { contacts: { displayName: `${list.length} Contact`, contacts: list }, ...opts }, { quoted });
        };

        conn.sendFile = async (jid, path, filename = '', caption = '', quoted, ptt = false, options = {}) => {
            let type = await conn.getFile(path, true)
            let { res, data: file, filename: pathFile } = type
            if (res && res.status !== 200 || file.length <= 65536) {
                try { throw { json: JSON.parse(file.toString()) } }
                catch (e) { if (e.json) throw e.json }
            }
            let opt = { filename }
            if (quoted) opt.quoted = quoted
            if (!type) options.asDocument = true
            let mtype = '', mimetype = type.mime, convert
            if (/webp/.test(type.mime) || (/image/.test(type.mime) && options.asSticker)) mtype = 'sticker'
            else if (/image/.test(type.mime) || (/webp/.test(type.mime) && options.asImage)) mtype = 'image'
            else if (/video/.test(type.mime)) mtype = 'video'
            else if (/audio/.test(type.mime)) (
                convert = await (ptt ? toPTT : toAudio)(file, type.ext),
                file = convert.data,
                pathFile = convert.filename,
                mtype = 'audio',
                mimetype = 'audio/ogg; codecs=opus'
            )
            else mtype = 'document'
            if (options.asDocument) mtype = 'document'

            let message = {
                ...options,
                caption,
                ptt,
                [mtype]: { url: pathFile },
                mimetype
            }
            let m
            try {
                m = await conn.sendMessage(jid, message, { ...opt, ...options })
            } catch (e) {
                console.error(e)
                m = null
            } finally {
                if (!m) m = await conn.sendMessage(jid, { ...message, [mtype]: file }, { ...opt, ...options })
                return m
            }
        } 

        conn.sendStatusMention = async (content, jids = []) => {
            try {
                let users = [];
                
                for (let id of jids) {
                    try {
                        let userId = await conn.groupMetadata(id);
                        const participants = userId.participants || [];
                        users = [...users, ...participants.map(u => conn.decodeJid(u.id))];
                    } catch (error) {
                        console.error('Error getting group metadata for', id, error);
                    }
                };

                users = [...new Set(users.filter(u => u))];

                let message = await conn.sendMessage(
                    "status@broadcast", 
                    content, 
                    {
                        backgroundColor: "#000000",
                        font: Math.floor(Math.random() * 9),
                        statusJidList: users,
                        additionalNodes: [
                            {
                                tag: "meta",
                                attrs: {},
                                content: [
                                    {
                                        tag: "mentioned_users",
                                        attrs: {},
                                        content: jids.map((jid) => ({
                                            tag: "to",
                                            attrs: { jid },
                                            content: undefined,
                                        })),
                                    },
                                ],
                            },
                        ],
                    }
                );

                for (let id of jids) {
                    try {
                        await conn.relayMessage(id, {
                            groupStatusMentionMessage: {
                                message: {
                                    protocolMessage: {
                                        key: message.key,
                                        type: 25,
                                    },
                                },
                            },
                        }, {});
                        await delay(2500);
                    } catch (error) {
                        console.error('Error relaying message to', id, error);
                    }
                }
                
                return message;
            } catch (error) {
                console.error('Error in sendStatusMention:', error);
                throw error;
            }
        };

        conn.serializeM = (m) => smsg(conn, m, store);

        conn.copyNForward = async (jid, message, forceForward = false, options = {}) => {
            let vtype;
            if (options.readViewOnce) {
                message.message = message.message?.ephemeralMessage?.message || message.message;
                vtype = Object.keys(message.message.viewOnceMessage.message)[0];
                delete message.message.viewOnceMessage.message[vtype].viewOnce;
                message.message = { ...message.message.viewOnceMessage.message };
            }

            let mtype = Object.keys(message.message)[0];
            let content = await generateForwardMessageContent(message, forceForward);
            let ctype = Object.keys(content)[0];
            let context = {};

            if (mtype != "conversation") {
                context = message.message[mtype].contextInfo;
            }

            content[ctype].contextInfo = {
                ...context,
                ...content[ctype].contextInfo,
            };

            const waMessage = await generateWAMessageFromContent(
                jid,
                content,
                options
                    ? {
                        ...content[ctype],
                        ...options,
                        ...(options.contextInfo
                            ? {
                                contextInfo: {
                                    ...content[ctype].contextInfo,
                                    ...options.contextInfo,
                                },
                            }
                            : {}),
                    }
                    : {}
            );

            await conn.relayMessage(jid, waMessage.message, { messageId: waMessage.key.id });
            return waMessage;
        };

        function createTmpFolder() {
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }
        }
     
        createTmpFolder();

        // Clean temp files periodically
        setInterval(() => {
            try {
                if (fs.existsSync(tmpDir)) {
                    const files = fs.readdirSync(tmpDir);
                    const now = Date.now();
                    let cleaned = 0;
                    
                    files.forEach(file => {
                        try {
                            const filePath = path.join(tmpDir, file);
                            const stats = fs.statSync(filePath);
                            const age = now - stats.mtimeMs;
                            
                            // Delete temp files older than 1 hour
                            if (age > 60 * 60 * 1000) {
                                fs.unlinkSync(filePath);
                                cleaned++;
                            }
                        } catch {}
                    });
                    
                    if (cleaned > 0) {
                        console.log(chalk.green(`[Temp Cleanup] ✅ Removed ${cleaned} old temp files`));
                    }
                }
            } catch (err) {
                console.error('[Temp Cleanup] Error:', err.message);
            }
        }, 30 * 60 * 1000); // Every 30 minutes

        function getTypeMessage(message) {
            if (!message) return 'unknown';
            const type = Object.keys(message);
            var restype = (!['senderKeyDistributionMessage', 'messageContextInfo'].includes(type[0]) && type[0]) ||
                (type.length >= 3 && type[1] !== 'messageContextInfo' && type[1]) ||
                type[type.length - 1] || Object.keys(message)[0];
            return restype;
        }

        conn.getFile = async (PATH, returnAsFilename) => {
            let res, filename;
            const data = Buffer.isBuffer(PATH) 
                ? PATH 
                : /^data:.*?\/.*?;base64,/i.test(PATH) 
                ? Buffer.from(PATH.split`, `[1], 'base64') 
                : /^https?:\/\//.test(PATH) 
                ? await (res = await fetch(PATH)).buffer() 
                : fs.existsSync(PATH) 
                ? (filename = PATH, fs.readFileSync(PATH)) 
                : typeof PATH === 'string' 
                ? PATH 
                : Buffer.alloc(0);

            if (!Buffer.isBuffer(data)) throw new TypeError('Result is not a buffer');
            
            const type = await FileType.fromBuffer(data) || { mime: 'application/octet-stream', ext: '.bin' };
            
            if (returnAsFilename && !filename) {
                filename = path.join(tmpDir, new Date() * 1 + '.' + type.ext);
                await fs.promises.writeFile(filename, data);
            }
            
            const deleteFile = async () => {
                if (filename && fs.existsSync(filename)) {
                    await fs.promises.unlink(filename).catch(() => {}); 
                }
            };

            setImmediate(deleteFile);
            
            return { res, filename, ...type, data, deleteFile };
        };

        conn.prefa = settings.prefa;
        conn.public = config.autoviewstatus || true;
        conn.serializeM = (m) => smsg(conn, m, store);

        conn.sendText = (jid, text, quoted = '', options) => conn.sendMessage(jid, { text: text, ...options }, { quoted });

        conn.deleteMessage = async (chatId, key) => {
            try {
                await conn.sendMessage(chatId, { delete: key });
                console.log(`Pesan dihapus: ${key.id}`);
            } catch (error) {
                console.error('Gagal menghapus pesan:', error);
            }
        };

        conn.downloadMediaMessage = async (message) => {
            let mime = (message.msg || message).mimetype || '';
            let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
            const stream = await downloadContentFromMessage(message, messageType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            return buffer;
        };

        conn.ev.on('creds.update', saveCreds);
        conn.serializeM = (m) => smsg(conn, m, store);
        
        return conn;
        
    } catch (error) {
        console.error(chalk.red('[FATAL ERROR]'), error);
        console.log(chalk.yellow('[SYSTEM] Attempting to restart in 10 seconds...'));
        await sleep(10000);
        clientstart();
    }
}

const porDir = path.join(__dirname, 'data');
const porPath = path.join(porDir, 'Jexploit.html');

function getUptime() {
    return runtime(process.uptime());
}

app.get("/", (req, res) => {
    res.sendFile(porPath);
});

app.get("/uptime", (req, res) => {
    res.json({ uptime: getUptime() });
});

app.listen(port, (err) => {
    if (err) {
        console.error(color(`Failed to start server on port: ${port}`, 'red'));
    } else {
        console.log(color(`[Vesper-Xmd] Running on port: ${port}`, 'white'));
    }
});

// Global error handlers
process.on('uncaughtException', function (err) {
    console.log(chalk.red('[UNCAUGHT EXCEPTION]'), err);
    console.log(chalk.yellow('[SYSTEM] Attempting to continue...'));
});

process.on('unhandledRejection', function (err) {
    console.log(chalk.red('[UNHANDLED REJECTION]'), err);
});

// Start the bot
clientstart();

let file = require.resolve(__filename);
fs.watchFile(file, () => {
    fs.unwatchFile(file);
    console.log(chalk.redBright(`Update ${__filename}`));
    delete require.cache[file];
    require(file);
});