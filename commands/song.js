const fs = require("fs");
const axios = require("axios");
const yts = require("yt-search");
const path = require("path");
const os = require("os");
const { createFakeContact } = require('../lib/fakeContact');

async function songCommand(sock, chatId, message) {
    try {
        await sock.sendMessage(chatId, {
            react: { text: "🎼", key: message.key }
        });

        // Define sender with fallback chain
        const sender = message.key || message.key?.fromMe || message;

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
                }, { quoted: createFakeContact(message) });
            } else if (quoted.videoMessage) {
                const caption = quoted.videoMessage.caption || "";
                if (caption) query = caption.trim();
                else {
                    return await sock.sendMessage(chatId, {
                        video: quoted.videoMessage,
                        mimetype: "video/mp4",
                        fileName: "quoted_video.mp4"
                    }, { quoted: createFakeContact(message) });
                }
            }
        }

        if (!query) {
            return await sock.sendMessage(chatId, {
                text: "🎵 Provide a song name or reply to a message with .song\nExample: .song Not Like Us"
            }, { quoted: createFakeContact(message) });
        }

        if (query.length > 100) {
            return await sock.sendMessage(chatId, {
                text: "📝 Song name too long! Max 100 chars."
            }, { quoted: createFakeContact(message) });
        }

        // Search YouTube
        const searchResult = (await yts(query + " official")).videos[0];
        if (!searchResult) {
            return sock.sendMessage(chatId, {
                text: "😕 Couldn't find that song. Try another one!"
            }, { quoted: createFakeContact(message) });
        }

        const video = searchResult;
        
        // Try multiple APIs with fallbacks for large files
        let downloadUrl;
        let videoTitle;
        
        const apis = [
            `https://www.apiskeith.top/download/audio?url=${encodeURIComponent(video.url)}`,
            `https://apis.xwolf.space/download/audio?url=${encodeURIComponent(video.url)}`,
            `https://api.giftedtech.co.ke/api/download/dlmp3?apikey=gifted&url=${encodeURIComponent(video.url)}`
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
                } else if (api.includes('wolf')) {
                    if (response.data?.success && response.data?. downloadUrl) {
                        downloadUrl = response.data.downloadUrl;
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
            timeout: 900000,
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
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                reject(err);
            });
        });

        if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
            throw new Error("Download failed or empty file!");
        }

        await sock.sendMessage(chatId, {
            text: `_🎶 Playing:_\n_${videoTitle || video.title}_`
        }, { quoted: createFakeContact(message) });

        await sock.sendMessage(chatId, {
            audio: { url: filePath },
            mimetype: "audio/mpeg",
            fileName: `${video.title}.mp3`,
            ptt: false
        }, { quoted: createFakeContact(message) });

        await sock.sendMessage(chatId, {
            document: { url: filePath },
            mimetype: "audio/mpeg",
            fileName: `${(videoTitle || video.title).substring(0, 100)}.mp3`
        }, { quoted: createFakeContact(message) });

        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    } catch (error) {
        console.error("Song command error:", error);
        return await sock.sendMessage(chatId, {
            text: `🚫 Error: ${error.message}`
        }, { quoted: createFakeContact(message) });
    }
}

module.exports = songCommand;
