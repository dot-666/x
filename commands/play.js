const fs = require("fs");
const fsPromises = require("fs").promises;
const axios = require("axios");
const yts = require("yt-search");
const path = require("path");
const os = require("os");

const { createFakeContact } = require('../lib/fakeContact');

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function cleanupOldFiles(dir, maxAgeMs = 3600000) { // 1 hour
    try {
        const files = await fsPromises.readdir(dir);
        const now = Date.now();
        for (const file of files) {
            const filePath = path.join(dir, file);
            try {
                const stat = await fsPromises.stat(filePath);
                if (now - stat.mtimeMs > maxAgeMs) {
                    await fsPromises.unlink(filePath);
                }
            } catch (e) {
                // ignore individual file errors
            }
        }
    } catch (e) {
        // ignore directory read errors
    }
}

async function playCommand(sock, chatId, message) {
    try {
        const fkontak = createFakeContact(message);

        await sock.sendMessage(chatId, {
            react: { text: "🎼", key: message.key }
        }, { quoted: createFakeContact(message) });

        const tempDir = path.join(os.tmpdir(), "june-x-temp");
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        let text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        let query = text ? text.split(" ").slice(1).join(" ").trim() : null;

        if (!query) {
            return await sock.sendMessage(chatId, {
                text: "🎵 Provide a song name!\nExample: .play Not Like Us"
            }, { quoted: createFakeContact(message) });
        }

        if (query.length > 100) {
            return await sock.sendMessage(chatId, {
                text: "📝 Song name too long! Max 100 chars."
            }, { quoted: createFakeContact(message) });
        }

        const searchResult = (await yts(query + " official")).videos[0];
        if (!searchResult) {
            return sock.sendMessage(chatId, {
                text: "😕 Couldn't find that song. Try another one!"
            }, { quoted: createFakeContact(message) });
        }

        const video = searchResult;

        let downloadUrl, videoTitle;
        const apis = [
            `https://media.cypherxbot.space/download/youtube/audio?url=${encodeURIComponent(video.url)}`,
            `https://apis.xwolf.space/download/audio?url=${encodeURIComponent(video.url)}`,
            `https://api.giftedtech.co.ke/api/download/dlmp3?apikey=gifted&url=${encodeURIComponent(video.url)}`
        ];

        for (const api of apis) {
            try {
                const response = await axios.get(api, { 
                    timeout: 30000,
                    headers: { "User-Agent": USER_AGENT }
                });
                if (api.includes("cypherx") && response.data?.status) {
                    downloadUrl = response.data.result.download_url;
                    videoTitle = response.data.result.title || video.title;
                    break;
                } else if (api.includes("wolf") && response.data?.success && response.data?.downloadUrl) {
                    downloadUrl = response.data.downloadUrl;
                    videoTitle = response.data.title || video.title;
                    break;
                } else if (api.includes("gifted") && response.data?.status && response.data?.result?.download_url) {
                    downloadUrl = response.data.result.download_url;
                    videoTitle = response.data.result.title || video.title;
                    break;
                }
            } catch (e) {
                continue;
            }
        }

        if (!downloadUrl) throw new Error("API failed to fetch track!");

        const filePath = path.join(tempDir, `audio_${Date.now()}.mp3`);

        // Download with space error handling
        let downloadSuccess = false;
        for (let attempt = 1; attempt <= 2; attempt++) { // max 2 attempts
            try {
                const audioResponse = await axios({
                    method: "get",
                    url: downloadUrl,
                    responseType: "stream",
                    timeout: 900000,
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                    headers: { "User-Agent": USER_AGENT }
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

                downloadSuccess = true;
                break; // success, exit retry loop
            } catch (err) {
                // If ENOSPC, clean up old files and retry once
                if (err.code === 'ENOSPC' && attempt === 1) {
                    await cleanupOldFiles(tempDir);
                    // continue to next attempt
                } else {
                    throw err; // rethrow other errors or second failure
                }
            }
        }

        if (!downloadSuccess) throw new Error("Download failed after retry due to space.");

        const title = (videoTitle || video.title).substring(0, 100);

        await sock.sendMessage(chatId, {
            text: `_🎶 Track ready:_\n_${title}_`
        }, { quoted: createFakeContact(message) });

        await sock.sendMessage(chatId, {
            document: { url: filePath },
            mimetype: "audio/mpeg",
            fileName: `${title}.mp3`
        }, { quoted: createFakeContact(message) });

        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    } catch (error) {
        console.error("Play command error:", error);
        return await sock.sendMessage(chatId, {
            text: `🚫 Error: ${error.message}`
        }, { quoted: createFakeContact(message) });
    }
}

module.exports = playCommand;
