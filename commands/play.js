const fs = require("fs");
const axios = require("axios");
const yts = require("yt-search");
const path = require("path");
const os = require("os");

const { createFakeContact } = require('../lib/fakeContact');

// Browser-like User-Agent
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function playCommand(sock, chatId, message) {
    try {
        const fkontak = createFakeContact(message);

        await sock.sendMessage(chatId, {
            react: { text: "🎼", key: message.key }
        }, { quoted: createFakeContact(message) });

        // Use system temp directory
        const tempDir = path.join(os.tmpdir(), "june-x-temp");
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        // Extract query
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

        // Search YouTube
        const searchResult = (await yts(query + " official")).videos[0];
        if (!searchResult) {
            return sock.sendMessage(chatId, {
                text: "😕 Couldn't find that song. Try another one!"
            }, { quoted: createFakeContact(message) });
        }

        const video = searchResult;

        // Use only the first API (cypherx)
        const apiUrl = `https://media.cypherxbot.space/download/youtube/audio?url=${encodeURIComponent(video.url)}`;
        
        let downloadUrl, videoTitle;
        try {
            const response = await axios.get(apiUrl, { 
                timeout: 30000,
                headers: { "User-Agent": USER_AGENT }
            });
            
            if (response.data?.status) {
                downloadUrl = response.data.result.download_url;
                videoTitle = response.data.result.title || video.title;
            } else {
                throw new Error("API returned unsuccessful status");
            }
        } catch (e) {
            throw new Error("Primary API failed: " + e.message);
        }

        if (!downloadUrl) throw new Error("No download URL received from API");

        const filePath = path.join(tempDir, `audio_${Date.now()}.mp3`);

        // Download MP3
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
