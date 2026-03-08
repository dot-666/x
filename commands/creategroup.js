const fs = require('fs');
const path = require('path');
const { resolveToPhoneJid } = require('../lib/jid');

// --- Utility: Owner Number ---
const { createFakeContact } = require('../lib/fakeContact');
function getOwnerNumber() {
    try {
        const ownerPath = path.join(__dirname, '..', 'data', 'owner.json');
        if (fs.existsSync(ownerPath)) {
            const data = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
            if (data.ownerNumber) {
                return data.ownerNumber.replace('@s.whatsapp.net', '');
            }
        }
    } catch (e) {}
    return ; // fallback
}

// --- Utility: Sudo List ---
function getSudoList() {
    try {
        const sudoPath = path.join(__dirname, '..', 'data', 'sudo.json');
        if (fs.existsSync(sudoPath)) {
            const data = JSON.parse(fs.readFileSync(sudoPath, 'utf8'));
            return Array.isArray(data) ? data : [];
        }
    } catch (e) {}
    return [];
}

// --- Utility: Normalize JID ---
function toPhoneJid(jid) {
    if (!jid) return jid;
    const resolved = resolveToPhoneJid(jid);
    if (resolved && !resolved.endsWith('@lid')) {
        return resolved;
    }
    const num = jid.split('@')[0].split(':')[0];
    return `${num}@s.whatsapp.net`;
}

// --- Main Command ---
async function createGroupCommand(sock, chatId, senderId, message, rawText) {
    try {
        const ownerNum = getOwnerNumber();
        const senderNum = senderId.split('@')[0].split(':')[0];
        const sudoList = getSudoList();
        const isSudo = sudoList.includes(senderNum);
        const isFromMe = message.key.fromMe;
        const senderIsOwner = senderNum === ownerNum || isFromMe;

        // Permission check
        if (!senderIsOwner && !isSudo) {
            await sock.sendMessage(chatId, { text: '❌ Only the owner or sudo users can create groups.' }, { quoted: createFakeContact(message) });
            return;
        }

        // Argument parsing
        const args = (rawText || '').trim();
        if (!args) {
            await sock.sendMessage(chatId, {
                text: `📝 Usage:\n.creategroup <Group Name>\n.creategroup <Group Name> | <number1>,<number2>,...`
            }, { quoted: createFakeContact(message) });
            return;
        }

        const parts = args.split('|').map(p => p.trim());
        const groupName = parts[0];
        if (!groupName) {
            await sock.sendMessage(chatId, { text: '❌ Please provide a group name.' }, { quoted: createFakeContact(message) });
            return;
        }

        // Participants
        let participants = [];
        if (parts[1]) {
            const numbers = parts[1].split(',').map(n => n.trim().replace(/[^0-9]/g, '')).filter(n => n.length >= 7);
            participants = numbers.map(n => `${n}@s.whatsapp.net`);
        }

        const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        for (const jid of mentioned) {
            const phoneJid = toPhoneJid(jid);
            if (!participants.includes(phoneJid)) participants.push(phoneJid);
        }

        let botPhoneJid = null;
        if (sock.user?.id) {
            const botNum = sock.user.id.split('@')[0].split(':')[0];
            botPhoneJid = `${botNum}@s.whatsapp.net`;
        }

        const senderPhoneJid = toPhoneJid(senderId);
        if (senderPhoneJid && !participants.includes(senderPhoneJid)) participants.push(senderPhoneJid);

        const uniqueParticipants = participants
            .filter(p => p && !p.endsWith('@lid') && p !== botPhoneJid)
            .filter((p, i, arr) => arr.indexOf(p) === i);

        // Notifications
        console.log('\x1b[35m[CREATEGROUP] Starting group creation...\x1b[0m');
        await sock.sendMessage(chatId, { text: `⏳ Creating *${groupName}*...` }, { quoted: createFakeContact(message) });

        const group = await sock.groupCreate(groupName, uniqueParticipants);

        let inviteLink = '';
        try {
            const inviteCode = await sock.groupInviteCode(group.id);
            inviteLink = `\n🔗 https://chat.whatsapp.com/${inviteCode}`;
        } catch (e) {}

        console.log('\x1b[35m[CREATEGROUP] Group created successfully!\x1b[0m');
        await sock.sendMessage(chatId, {
            text: `✅ Group *${groupName}* created!\n👥 Members: ${uniqueParticipants.length + 1}${inviteLink}`
        }, { quoted: createFakeContact(message) });

        await sock.sendMessage(group.id, { text: `👋 Welcome to *${groupName}*!` }, { quoted: createFakeContact(message) });

    } catch (err) {
        console.error(`\x1b[35m[CREATEGROUP] Error: ${err.message}\x1b[0m`, err.stack);
        await sock.sendMessage(chatId, { text: `❌ Failed to create group: ${err?.message || 'Unknown error'}` }, { quoted: createFakeContact(message) });
    }
}

module.exports = { createGroupCommand };
