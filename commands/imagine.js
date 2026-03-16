const Scraper = require('images-scraper');
const google = new Scraper({
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

async function imageCommand(sock, chatId, message) {
    try {
        // Extract text from message
        const userMessage = message?.message?.conversation || 
                          message?.message?.extendedTextMessage?.text ||
                          '';
        
        const args = userMessage.split(' ').slice(1);
        const query = args.join(' ');

        if (!query) {
            return await sock.sendMessage(chatId, {
                text: `📷 *Image Search Command*\n\nUsage:\n.image <search_query>\n\nExample:\n.image cat\n.image beautiful sunset\n.image anime characters`
            });
        }

        await sock.sendMessage(chatId, {
            text: `🔍 Searching images for: "${query}"...`
        }, { quoted: message });

        // Perform search
        const results = await google.scrape(query, 5); // get top 5 images

        if (!results || results.length === 0) {
            return await sock.sendMessage(chatId, {
                text: `❌ No images found for "${query}"`
            });
        }

        const fancyBotName = `ᴊᴜɴᴇ-𝚇`;

        for (const result of results) {
            try {
                await sock.sendMessage(chatId, {
                    image: { url: result.url },
                    caption: `📸 𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝𝐞𝐝 𝐛𝐲 ${fancyBotName}`
                }, { quoted: message });

                // Small delay between sends
                await new Promise(res => setTimeout(res, 500));
            } catch (err) {
                console.error('Error sending image:', err);
            }
        }
    } catch (error) {
        console.error('Image command error:', error);
        await sock.sendMessage(chatId, {
            text: '❌ An unexpected error occurred. Please try again.'
        });
    }
}

module.exports = imageCommand;
