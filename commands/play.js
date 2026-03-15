const fs = require("fs");
const axios = require("axios");
const yts = require("yt-search");
const path = require("path");
const os = require("os");

const { createFakeContact } = require("../lib/fakeContact");

async function playCommand(sock, chatId, message) {
    const fkontak = createFakeContact(message);

    try {
        // React to command
        await sock.sendMessage(chatId, {
            react: { text: "🎼", key: message.key }
        }, { quoted: fkontak });

        // Prepare temp dir
        const tempDir = path.join(os.tmpdir(), "june-x-temp");
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        // Extract query
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        const query = text ? text.split(" ").slice(1).join(" ").trim() : null;

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
                url: `https://apiskeith.top/download/audio?url=${encodeURIComponent(video.url)}`,
                parse: (res) => {
                    if (res.data?.status && res.data?.result) {
                        return {
                            downloadUrl: res.data.result,
                            title: res.data.title || video.title
                        };
                    }
                    return null;
                }
            },
            {
                url: `https://apis.xwolf.space/download/audio?url=${encodeURIComponent(video.url)}`,
                parse: (res) => {
                    if (res.data?.success && res.data?.downloadUrl) {
                        return {
                            downloadUrl: res.data.downloadUrl,
                            title: res.data.title || video.title
                        };
                    }
                    return null;
                }
            },
            {
                url: `https://api.giftedtech.co.ke/api/download/dlmp3?apikey=gifted&url=${encodeURIComponent(video.url)}`,
                parse: (res) => {
                    if (res.data?.status && res.data?.result?.download_url) {
                        return {
                            downloadUrl: res.data.result.download_url,
                            title: res.data.result.title || video.title
                        };
                    }
                    return null;
                }
            }
        ];

        let downloadUrl, videoTitle;
        for (const api of apis) {
            try {
                const res = await axios.get(api.url, { 
                    timeout: 30000,
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                });
                const parsed = api.parse(res);
                if (parsed) {
                    downloadUrl = parsed.downloadUrl;
                    videoTitle = parsed.title;
                    break;
                }
            } catch (error) {
                console.log(`API failed: ${api.url.split('/')[2]} - ${error.message}`);
                continue;
            }
        }

        if (!downloadUrl) {
            throw new Error("Could not fetch audio from any available source");
        }

        // Download MP3
        const filePath = path.join(tempDir, `audio_${Date.now()}.mp3`);
        await downloadFile(downloadUrl, filePath);

        const title = (videoTitle || video.title).substring(0, 100).replace(/[<>:"/\\|?*]/g, '_');

        // Create metadata document
        const docPath = path.join(tempDir, `info_${Date.now()}.txt`);
        fs.writeFileSync(
            docPath,
            `🎶 Track Info\n\nTitle: ${title}\nYouTube: ${video.url}\nDuration: ${video.timestamp || 'Unknown'}\nViews: ${video.views || 'Unknown'}`
        );

        // Notify user
        await sock.sendMessage(chatId, {
            text: `_🎶 Track ready:_\n_${title}_`
        }, { quoted: fkontak });

        // Send audio properly
        await sock.sendMessage(chatId, {
            audio: { url: filePath },
            mimetype: "audio/mpeg",
            fileName: `${title}.mp3`,
            ptt: false
        }, { quoted: fkontak });

        // Send metadata doc
        await sock.sendMessage(chatId, {
            document: { url: docPath },
            mimetype: "text/plain",
            fileName: `${title}_info.txt`
        }, { quoted: fkontak });

        // Cleanup after sending
        setTimeout(() => {
            [filePath, docPath].forEach(p => {
                if (fs.existsSync(p)) {
                    try {
                        fs.unlinkSync(p);
                    } catch (err) {
                        console.log(`Failed to delete ${p}: ${err.message}`);
                    }
                }
            });
        }, 5000); // wait 5s to ensure sendMessage completes

    } catch (error) {
        console.error("Play command error:", error);
        return sock.sendMessage(chatId, {
            text: `🚫 Error: ${error.message}`
        }, { quoted: fkontak });
    }
}

// Helper: download file to disk
async function downloadFile(url, filePath) {
    try {
        const response = await axios({
            method: "get",
            url,
            responseType: "stream",
            timeout: 1800000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on("finish", resolve);
            writer.on("error", (err) => {
                if (fs.existsSync(filePath)) {
                    try {
                        fs.unlinkSync(filePath);
                    } catch (unlinkErr) {
                        console.log(`Failed to delete incomplete file: ${unlinkErr.message}`);
                    }
                }
                reject(err);
            });
        });
    } catch (error) {
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (unlinkErr) {
                console.log(`Failed to delete incomplete file: ${unlinkErr.message}`);
            }
        }
        throw error;
    }
}

module.exports = playCommand;
