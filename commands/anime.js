const axios = require('axios');
const { createFakeContact } = require('../lib/fakeContact');

// nekos.best v2 — free, no auth, very reliable
// https://nekos.best/api/v2/{endpoint}
// Returns: { results: [{ url: "...", anime_name: "..." }] }
const NEKOS_BEST = 'https://nekos.best/api/v2';

// All supported types grouped
const GIF_TYPES = [
    'hug', 'kiss', 'pat', 'poke', 'cry', 'wink', 'nom', 'pout',
    'bite', 'blush', 'bored', 'cuddle', 'dance', 'facepalm', 'feed',
    'handhold', 'happy', 'highfive', 'kick', 'laugh', 'nod', 'nope',
    'punch', 'run', 'sad', 'shoot', 'shrug', 'sip', 'slap', 'sleep',
    'smile', 'smug', 'stare', 'think', 'thumbsup', 'tickle', 'wag',
    'wave', 'yawn', 'yeet'
];
const IMAGE_TYPES = ['neko', 'waifu', 'husbando', 'kitsune'];
const ALL_TYPES = [...GIF_TYPES, ...IMAGE_TYPES, 'quote'];

function normalizeType(input) {
    const lower = (input || '').toLowerCase().trim();
    const aliases = {
        'facepalm': 'facepalm',
        'face-palm': 'facepalm',
        'face_palm': 'facepalm',
        'nome': 'nom',
        'hug': 'hug',
        'kiss': 'kiss',
        'pat': 'pat',
        'loli': 'neko',
        'animuquote': 'quote',
        'animu-quote': 'quote',
        'cutte': 'cuddle',
    };
    return aliases[lower] || lower;
}

async function fetchNEKOSBest(type) {
    const url = `${NEKOS_BEST}/${type}`;
    const res = await axios.get(url, { timeout: 15000 });
    const result = res.data?.results?.[0];
    if (!result?.url) throw new Error(`No URL from nekos.best for type: ${type}`);
    return result;
}

async function fetchQuote() {
    // Try nekos.best quote endpoint
    try {
        const res = await axios.get(`${NEKOS_BEST}/quote`, { timeout: 15000 });
        const result = res.data?.results?.[0];
        if (result?.quote) return { text: `"${result.quote}"\n\n— ${result.character || 'Unknown'} (${result.anime || 'Anime'})` };
    } catch (_) {}
    // Fallback: animechan
    try {
        const res = await axios.get('https://animechan.io/api/v1/quotes/random', { timeout: 10000 });
        const d = res.data?.data;
        if (d?.content) return { text: `"${d.content}"\n\n— ${d.character?.name || 'Unknown'} (${d.anime?.name || 'Anime'})` };
    } catch (_) {}
    throw new Error('Could not fetch anime quote');
}

async function sendAnimu(sock, chatId, message, type) {
    const fake = createFakeContact(message);

    try {
        if (type === 'quote') {
            const { text } = await fetchQuote();
            await sock.sendMessage(chatId, { text }, { quoted: fake });
            return;
        }

        // Determine if it's an image or GIF type
        const isImageType = IMAGE_TYPES.includes(type);
        const result = await fetchNEKOSBest(type);
        const mediaUrl = result.url;
        const animeSource = result.anime_name ? ` (${result.anime_name})` : '';

        if (isImageType) {
            await sock.sendMessage(chatId,
                { image: { url: mediaUrl }, caption: `🌸 ${type}${animeSource}` },
                { quoted: fake }
            );
        } else {
            // GIF — send as video with gifPlayback true so WhatsApp loops it
            await sock.sendMessage(chatId,
                { video: { url: mediaUrl }, caption: `🎌 ${type}${animeSource}`, gifPlayback: true },
                { quoted: fake }
            );
        }
    } catch (err) {
        console.error(`[anime] Error fetching ${type}:`, err.message);
        await sock.sendMessage(chatId,
            { text: `❌ Failed to fetch *${type}*. Try again later.` },
            { quoted: fake }
        );
    }
}

async function animeCommand(sock, chatId, message, args) {
    const fake = createFakeContact(message);
    const subArg = args && args[0] ? args[0] : '';
    const sub = normalizeType(subArg);

    if (!sub) {
        const gifList = GIF_TYPES.slice(0, 12).join(', ');
        const imgList = IMAGE_TYPES.join(', ');
        await sock.sendMessage(chatId, {
            text: `🎌 *ANIME COMMANDS*\n\n` +
                  `*GIF Reactions:* ${gifList}, ...\n\n` +
                  `*Images:* ${imgList}\n\n` +
                  `*Other:* quote\n\n` +
                  `*Usage:* \`.animu hug\`\n` +
                  `*Or use shortcuts:* \`.hug\`, \`.kiss\`, \`.pat\`, \`.cry\`, etc.`
        }, { quoted: fake });
        return;
    }

    if (!ALL_TYPES.includes(sub)) {
        await sock.sendMessage(chatId, {
            text: `❌ Unknown type: *${sub}*\n\nTry: ${ALL_TYPES.slice(0, 15).join(', ')}...`
        }, { quoted: fake });
        return;
    }

    await sendAnimu(sock, chatId, message, sub);
}

module.exports = { animeCommand };
