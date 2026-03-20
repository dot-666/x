const axios = require('axios');
const { createFakeContact } = require('../lib/fakeContact');

// Multiple Sora/text-to-video API endpoints to try in order
const SORA_APIS = [
    async (prompt) => {
        const url = `https://api.siputzx.my.id/api/ai/sora?text=${encodeURIComponent(prompt)}`;
        const { data } = await axios.get(url, { timeout: 90000, headers: { 'user-agent': 'Mozilla/5.0' } });
        return data?.data?.video || data?.videoUrl || data?.result || null;
    },
    async (prompt) => {
        const url = `https://okatsu-rolezapiiz.vercel.app/ai/txt2video?text=${encodeURIComponent(prompt)}`;
        const { data } = await axios.get(url, { timeout: 90000, headers: { 'user-agent': 'Mozilla/5.0' } });
        return data?.videoUrl || data?.result || data?.data?.videoUrl || data?.data?.url || null;
    },
    async (prompt) => {
        const url = `https://api.vreden.my.id/api/ai/sora?prompt=${encodeURIComponent(prompt)}`;
        const { data } = await axios.get(url, { timeout: 90000, headers: { 'user-agent': 'Mozilla/5.0' } });
        return data?.result?.video || data?.videoUrl || data?.result || null;
    },
];

async function soraCommand(sock, chatId, message) {
    const fake = createFakeContact(message);
    try {
        const rawText =
            message.message?.conversation?.trim() ||
            message.message?.extendedTextMessage?.text?.trim() ||
            message.message?.imageMessage?.caption?.trim() ||
            message.message?.videoMessage?.caption?.trim() || '';

        const used = rawText.split(/\s+/)[0] || '.sora';
        const args = rawText.slice(used.length).trim();
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedText = quoted?.conversation || quoted?.extendedTextMessage?.text || '';
        const input = args || quotedText;

        if (!input) {
            await sock.sendMessage(chatId, {
                text: `🎬 *SORA VIDEO GENERATOR*\n\n` +
                      `Generate AI videos from text prompts.\n\n` +
                      `*Usage:* \`.sora anime girl with blue hair in cherry blossom forest\`\n\n` +
                      `_Note: Generation takes 30-90 seconds, please wait..._`
            }, { quoted: fake });
            return;
        }

        // Let user know it's working (video gen takes a while)
        await sock.sendMessage(chatId, {
            text: `🎬 Generating video for: *${input}*\n\n_This may take up to 90 seconds..._`
        }, { quoted: fake });

        let videoUrl = null;
        let lastError = null;

        for (const tryApi of SORA_APIS) {
            try {
                videoUrl = await tryApi(input);
                if (videoUrl && typeof videoUrl === 'string' && videoUrl.startsWith('http')) {
                    break;
                }
                videoUrl = null;
            } catch (err) {
                lastError = err;
                console.error('[SORA] API attempt failed:', err?.message);
            }
        }

        if (!videoUrl) {
            throw new Error(lastError?.message || 'All APIs returned no video URL');
        }

        await sock.sendMessage(chatId, {
            video: { url: videoUrl },
            mimetype: 'video/mp4',
            caption: `🎬 *Sora AI Video*\n📝 Prompt: ${input}`
        }, { quoted: fake });

    } catch (error) {
        console.error('[SORA] Error:', error?.message || error);
        await sock.sendMessage(chatId, {
            text: `❌ Failed to generate video.\n\n_The AI video service may be temporarily unavailable. Try again later._`
        }, { quoted: fake });
    }
}

module.exports = soraCommand;
