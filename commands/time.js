const { createFakeContact } = require('../lib/fakeContact');

async function timeCommand(sock, chatId, message) {
    try {
        const now = new Date();

        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const months = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];

        const dayName = days[now.getDay()];
        const day = now.getDate();
        const month = months[now.getMonth()];
        const year = now.getFullYear();

        let hours = now.getHours();
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const hours12 = hours % 12 || 12;

        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        const text = `
🕐 *REAL-TIME CLOCK* 🕐

📅 *Date:*
🔹*Day:* ${dayName}
🔹*Date:* ${day} ${month} ${year}
🔹*Week Day:* Day ${now.getDay() + 1} of the week

⏰ *Time:*
🔹*12-Hour:* ${hours12}:${minutes}:${seconds} ${ampm}
🔹*24-Hour:* ${String(hours).padStart(2, '0')}:${minutes}:${seconds}
🔹*Timezone:* ${timeZone}
`.trim();

        await sock.sendMessage(chatId, { text }, { quoted: createFakeContact(message) });
    } catch (error) {
        console.error('Error in time command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to fetch current time.' }, { quoted: createFakeContact(message) });
    }
}

module.exports = timeCommand;
