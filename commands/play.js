const fs = require("fs");
const axios = require("axios");
const yts = require("yt-search");
const path = require("path");
const os = require("os");

const { createFakeContact } = require("../lib/fakeContact");

async function playCommand(sock, chatId, message) {
    try {
        const fkontak = createFakeContact(message);

        // React to command
        await sock.sendMessage(chatId, {
            react: { text: "🎼", key: message.key }
        }, { quoted: fkontak });

        // Temp directory
        const tempDir = path.join(os.tmpdir(), "june-x-temp");
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        // Extract query
        let text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        let query = text ? text.split(" ").slice(1).join(" ").trim() : null;

        if (!query) {
            return sock.sendMessage(chatId, {
                text: "🎵 Provide a song name!\nExample: .play Not Like Us"
            }, { quoted: fkontak });
        }

        if (query.length > 100) {
            return sock.sendMessage(chatId, {
                text: "📝 Song name too long! Max 100 chars."
            }, { quoted: fkontak });
        }

        // Search YouTube
        const searchResult = (await yts(query + " official")).videos[0];
        if (!searchResult) {
            return sock.sendMessage(chatId, {
                text: "😕 Couldn't find that song. Try another one!"
            }, { quoted: fkontak });
        }

        const video = searchResult;

        // API fallbacks
        const apis = [
            {
                name: "keith",
                url: `https://www.apiskeith.top/download/audio?url=${encodeURIComponent(video.url)}`
            },
            {
                name: "wolf",
                url: `https://apis.xwolf.space/download/audio?url=${encodeURIComponent(video.url)}`
            },
            {
                name: "gifted",
                url: `https://api.giftedtech.co.ke/api/download/dlmp3?apikey=gifted&url=${encodeURIComponent(video.url)}`
            }
        ];

        let downloadUrl, videoTitle;

        for (const api of apis) {
            try {
                const response = await axios.get(api.url, { timeout: 30000 });

                if (api.name === "keith" && response.data?.status) {
                    downloadUrl = response.data.result;
                    videoTitle = response.data.title || video.title;
                    break;
                }
                if (api.name === "wolf" && response.data?.success && response.data?.downloadUrl) {
                    downloadUrl = response.data.downloadUrl;
                    videoTitle = response.data.title || video.title;
                    break;
                }
                if (api.name === "gifted" && response.data?.status && response.data?.result?.download_url) {
                    downloadUrl = response.data.result.download_url;
                    videoTitle = response.data.result.title || video.title;
                    break;
                }
            } catch {
                continue;
            }
        }

        if (!downloadUrl) throw new Error("API failed to fetch track!");

        const filePath = path.join(tempDir, `audio_${Date.now()}.mp3`);

        // Download MP3 with 30min timeout
        const audioResponse = await axios({
            method: "get",
            url: downloadUrl,
            responseType: "stream",
            timeout: 1800000, // 30 minutes
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            headers: { "User-Agent": "Mozilla/5.0" }
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

        const title = (videoTitle || video.title).substring(0, 100);

        // Notify track ready
        await sock.sendMessage(chatId, {
            text: `_🎶 Track ready:_\n_${title}_`
        }, { quoted: fkontak });

        // Send as audio (playable in chat)
        await sock.sendMessage(chatId, {
            audio: { url: filePath },
            mimetype: "audio/mpeg",
            fileName: `${title}.mp3`
        }, { quoted: fkontak });

        // Send as document (downloadable)
        await sock.sendMessage(chatId, {
            document: { url: filePath },
            mimetype: "audio/mpeg",
            fileName: `${title}.mp3`
        }, { quoted: fkontak });

        // Cleanup
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    } catch (error) {
        const fkontak = createFakeContact(message);
        return sock.sendMessage(chatId, {
            text: `🚫 Error: ${error.message}`
        }, { quoted: fkontak });
    }
}

module.exports = playCommand;
