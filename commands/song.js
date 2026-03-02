const fs = require("fs");
const axios = require("axios");
const yts = require("yt-search");
const path = require("path");
const os = require("os");

async function songCommand(sock, chatId, message) {
    try {
        await sock.sendMessage(chatId, {
            react: { text: "🎼", key: message.key }
        });

        // Define sender with fallback chain
        const sender = message.key || message.key?.fromMe || message;
        
        // Create fake contact for enhanced replies
        function createFakeContact(sender) {
            return {
                key: {
                    participants: "0@s.whatsapp.net",
                    remoteJid: "status@broadcast",
                    fromMe: false,
                    id: "JUNE-X-MENU"
                },
                message: {
                    contactMessage: {
                        displayName: "JUNE X",
                        vcard: `BEGIN:VCARD\nVERSION:3.0\nN:;JUNE X;;;\nFN:JUNE X\nORG:JUNE X Bot\nTEL;type=CELL;type=VOICE;waid=${sender.split('@')[0]}:${sender.split('@')[0]}\nEND:VCARD`
                    }
                },
                participant: "0@s.whatsapp.net"
            };
        }

        const fakeQuoted = createFakeContact(message.key?.participant || chatId);

        // Use system temp directory to avoid ENOTDIR errors
        const tempDir = path.join(os.tmpdir(), "june-x-temp");
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        // Extract query from direct text or quoted message
        let text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        let query = null;

        if (text) {
            const parts = text.split(" ");
            query = parts.slice(1).join(" ").trim();
        }

        // Check quoted message
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!query && quoted) {
            if (quoted.conversation) {
                query = quoted.conversation.trim();
            } else if (quoted.extendedTextMessage?.text) {
                query = quoted.extendedTextMessage.text.trim();
            } else if (quoted.audioMessage) {
                return await sock.sendMessage(chatId, {
                    audio: quoted.audioMessage,
                    mimetype: "audio/mpeg",
                    fileName: "quoted_audio.mp3"
                }, { quoted: fakeQuoted });
            } else if (quoted.videoMessage) {
                const caption = quoted.videoMessage.caption || "";
                if (caption) query = caption.trim();
                else {
                    return await sock.sendMessage(chatId, {
                        video: quoted.videoMessage,
                        mimetype: "video/mp4",
                        fileName: "quoted_video.mp4"
                    }, { quoted: fakeQuoted });
                }
            }
        }

        if (!query) {
            return await sock.sendMessage(chatId, {
                text: "🎵 Provide a song name or reply to a message with .song\nExample: .song Not Like Us"
            }, { quoted: fakeQuoted });
        }

        if (query.length > 100) {
            return await sock.sendMessage(chatId, {
                text: "📝 Song name too long! Max 100 chars."
            }, { quoted: fakeQuoted });
        }

        // Search YouTube
        const searchResult = (await yts(query + " official")).videos[0];
        if (!searchResult) {
            return sock.sendMessage(chatId, {
                text: "😕 Couldn't find that song. Try another one!"
            }, { quoted: fakeQuoted });
        }

        const video = searchResult;
        
        // Try multiple APIs with fallbacks for large files
        let downloadUrl;
        let videoTitle;
        
        const apis = [
            `https://www.apiskeith.top/download/audio?url=${encodeURIComponent(video.url)}`,
            `https://api.ryzendesu.vip/api/downloader/ytmp3?url=${encodeURIComponent(video.url)}`,
            `https://api.giftedtech.co.ke/api/download/ytmp3?apikey=gifted&url=${encodeURIComponent(video.url)}`
        ];
        
        for (const api of apis) {
            try {
                const response = await axios.get(api, { timeout: 30000 });
                
                if (api.includes('keith')) {
                    if (response.data && response.data?.status) {
                        downloadUrl = response.data.result;
                        videoTitle = response.data.title || video.title;
                        break;
                    }
                } else if (api.includes('ryzendesu')) {
                    if (response.data?.status && response.data?.url) {
                        downloadUrl = response.data.url;
                        videoTitle = response.data.title || video.title;
                        break;
                    }
                } else if (api.includes('gifted')) {
                    if (response.data?.status && response.data?.result?.download_url) {
                        downloadUrl = response.data.result.download_url;
                        videoTitle = response.data.result.title || video.title;
                        break;
                    }
                }
            } catch (e) {
                continue;
            }
        }
        
        if (!downloadUrl) throw new Error("API failed to fetch track!");

        const timestamp = Date.now();
        const fileName = `audio_${timestamp}.mp3`;
        const filePath = path.join(tempDir, fileName);

        // Download MP3 with support for files over 100MB
        const audioResponse = await axios({
            method: "get",
            url: downloadUrl,
            responseType: "stream",
            timeout: 900000, // 15 minutes for large files
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        const writer = fs.createWriteStream(filePath);
        audioResponse.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on("finish", resolve);
            writer.on("error", (err) => {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath); // cleanup partial file
                reject(err);
            });
        });

        if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
            throw new Error("Download failed or empty file!");
        }

        await sock.sendMessage(chatId, {
            text: `_🎶 Playing:_\n_${videoTitle || video.title}_`
        }, { quoted: fakeQuoted });

        // Send audio
        await sock.sendMessage(chatId, {
            audio: { url: filePath },
            mimetype: "audio/mpeg",
            fileName: `${video.title}.mp3`,
            ptt: false
        }, { quoted: fakeQuoted });

        // Send as document too
        await sock.sendMessage(chatId, {
            document: { url: filePath },
            mimetype: "audio/mpeg",
            fileName: `${(videoTitle || video.title).substring(0, 100)}.mp3`
        }, { quoted: fakeQuoted });

        // Cleanup
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    } catch (error) {
        console.error("Song command error:", error);
        return await sock.sendMessage(chatId, {
            text: `🚫 Error: ${error.message}`
        }, { quoted: message.key?.fromMe ? createFakeContact(message.key?.participant || chatId) : message });
    }
}

module.exports = songCommand;
