const yts = require('yt-search');
const { createFakeContact } = require('../lib/fakeContact');

async function ytsCommand(sock, chatId, senderId, message, userMessage) {
    try {
        const args = userMessage.split(' ').slice(1);
        const query = args.join(' ');

        if (!query) {
            return await sock.sendMessage(chatId, {
                text: `🔍 *YouTube Search Command*\n\nUsage:\n.yts <search_query>\n\nExample:\n.yts Godzilla\n.yts latest songs\n.yts tutorial for JUNE-X`
            }, { quoted: createFakeContact(message) });
        }

        await sock.sendMessage(chatId, {
            text: `🌍 Searching...: "${query}"`
        }, { quoted: createFakeContact(message) });

        let searchResults;
        try {
            searchResults = await yts(query);
        } catch (searchError) {
            console.error('YouTube search error:', searchError);
            return await sock.sendMessage(chatId, {
                text: '❌ Error searching YouTube. Please try again later.'
            }, { quoted: createFakeContact(message) });
        }

        const videos = (searchResults && searchResults.videos) ? searchResults.videos.slice(0, 5) : [];

        if (videos.length === 0) {
            return await sock.sendMessage(chatId, {
                text: `❌ No results found for "${query}"\n\nTry different keywords.`
            }, { quoted: createFakeContact(message) });
        }

        for (const video of videos) {
            const duration = video.timestamp || 'N/A';
            const views = video.views ? video.views.toLocaleString() : 'N/A';
            const uploadDate = video.ago || 'N/A';

            const caption = 
`*${video.title}*
🄹 *URL:* ${video.url}
🅄 *Duration:* ${duration}
🄽 *Views:* ${views}
🄴 *Uploaded:* ${uploadDate}
🅇 *Channel:* ${video.author?.name || 'N/A'}

☆ Tip: Use docytplay <url> to download audio
☆ Use docytvideo <url> to download video`;

            await sock.sendMessage(chatId, {
                image: { url: video.thumbnail },
                caption
            }, { quoted: createFakeContact(message) });
        }

    } catch (error) {
        console.error('YouTube search command error:', error);
        await sock.sendMessage(chatId, {
            text: '❌ An error occurred while searching YouTube. Please try again.'
        }, { quoted: createFakeContact(message) });
    }
}

module.exports = ytsCommand;
