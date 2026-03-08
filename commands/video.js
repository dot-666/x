const axios = require('axios');
const yts = require('yt-search');

const { createFakeContact } = require('../lib/fakeContact');
async function videoCommand(sock, chatId, message) {
    try {
        // Initial reaction
        await sock.sendMessage(chatId, {
            react: { text: '🎬', key: message.key }
        });

        const text = message.message?.conversation 
            || message.message?.extendedTextMessage?.text 
            || message.message?.imageMessage?.caption 
            || "";
        const parts = text.split(' ');
        const query = parts.slice(1).join(' ').trim();

        // Create fake quoted message
        const fake = createFakeContact(message);

        if (!query) {
            return sock.sendMessage(chatId, {
                text: 'Provide a YouTube link or name.\nExample:\nvideo Not Like Us\nvideo Espresso'
            }, { quoted: createFakeContact(message) });
        }

        if (query.length > 100) {
            return sock.sendMessage(chatId, {
                text: `Video name too long! Max 100 chars.`
            }, { quoted: createFakeContact(message) });
        }

        // Search video
        const searchResult = (await yts(query)).videos[0];
        if (!searchResult) {
            return sock.sendMessage(chatId, {
                text: "Couldn't find that video. Try another!"
            }, { quoted: createFakeContact(message) });
        }

        const video = searchResult;
        
        await sock.sendMessage(chatId, {
            text: `_Downloading: ${video.title}_._`
        }, { quoted: createFakeContact(message) });

        // API call (no 100MB limit)
        const apiUrl = `https://www.apiskeith.top/download/video?url=${encodeURIComponent(video.url)}`;

        let response;
        try {
            response = await axios.get(apiUrl, { 
                timeout: 300000, // 5 minutes
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });
        } catch (err) {
            if (err.message.includes("socket hang up") || err.code === 'ECONNABORTED') {
                response = await axios.get(apiUrl, { 
                    timeout: 300000,
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity
                });
            } else {
                throw err;
            }
        }

        const apiData = response.data;
        if (!apiData || !apiData.status) {
            throw new Error("API failed to fetch video!");
        }

        const caption = `Title: ${video.title}\nDuration: ${video.timestamp}`;
        const vid = apiData.result;

        // Try sending as document first
        try {
            await sock.sendMessage(chatId, {
                document: { url: vid },
                mimetype: "video/mp4",
                fileName: `${video.title.replace(/[^\w\s]/gi, '').substring(0, 80)}.mp4`,
                caption
            }, { quoted: fake, timeout: 300000 });

            await sock.sendMessage(chatId, {
                react: { text: '✅', key: message.key }
            });
            
        } catch (docError) {
            // Fallback to video format
            await sock.sendMessage(chatId, {
                video: { url: apiData.result.download_url },
                caption: `${caption}\n(Sent as video)`,
                mimetype: "video/mp4"
            }, { quoted: fake, timeout: 300000 });

            await sock.sendMessage(chatId, {
                react: { text: '✅', key: message.key }
            });
        }

    } catch (error) {
        let errorMessage = `Error: ${error.message}`;
        if (error.message.includes("timeout") || error.code === 'ECONNABORTED') {
            errorMessage = "Download timeout. Video may be too large.";
        } else if (error.message.includes("API failed")) {
            errorMessage = "API error. Try again later.";
        } else if (error.message.includes("socket hang up")) {
            errorMessage = "Connection lost. Please retry.";
        }

        await sock.sendMessage(chatId, {
            react: { text: '⚠️', key: message.key }
        });

        return sock.sendMessage(chatId, { text: errorMessage }, { quoted: createFakeContact(message) });
    }
}

module.exports = videoCommand;
