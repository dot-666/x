const fs = require('fs');
const path = require('path');
const { createFakeContact } = require('../lib/fakeContact');

function getOwnerNumber() {
    try {
        const ownerPath = path.join(__dirname, '..', 'data', 'owner.json');
        if (fs.existsSync(ownerPath)) {
            const data = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
            if (data.ownerNumber) return data.ownerNumber.replace('@s.whatsapp.net', '');
        }
    } catch (e) {}
    return null;
}

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

function toPhoneJid(jid) {
    if (!jid || typeof jid !== 'string') return null;
    const num = jid.split('@')[0].split(':')[0];
    return `${num}@s.whatsapp.net`;
}

async function createGroupCommand(sock, chatId, senderId, message, rawText) {
    try {
        const ownerNum = getOwnerNumber();
        const senderNum = senderId.split('@')[0].split(':')[0];
        const sudoList = getSudoList();
        const isSudo = sudoList.includes(senderNum);
        const isFromMe = message.key.fromMe;
        const senderIsOwner = senderNum === ownerNum || isFromMe;

        if (!senderIsOwner && !isSudo) {
            await sock.sendMessage(chatId, {
                text: '❌ Only the owner or sudo users can create groups.'
            }, { quoted: message });
            return;
        }

        // Strip the command word from rawText to get just the arguments
        const args = (rawText || '').replace(/^\S+\s*/, '').trim();

        if (!args) {
            await sock.sendMessage(chatId, {
                text: `📝 *Create Group Usage:*\n\n▸ *.creategroup <Name>*\n▸ *.creategroup <Name> | 1234567890,0987654321*\n\nYou can also @mention members.`
            }, { quoted: message });
            return;
        }

        const parts = args.split('|').map(p => p.trim());
        const groupName = parts[0];

        if (!groupName) {
            await sock.sendMessage(chatId, {
                text: '❌ Please provide a group name.'
            }, { quoted: message });
            return;
        }

        // Collect participants from numbers provided after |
        let participants = [];
        if (parts[1]) {
            const numbers = parts[1]
                .split(',')
                .map(n => n.trim().replace(/[^0-9]/g, ''))
                .filter(n => n.length >= 7);
            participants = numbers.map(n => `${n}@s.whatsapp.net`);
        }

        // Include any @mentioned users
        const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        for (const jid of mentioned) {
            const phoneJid = toPhoneJid(jid);
            if (phoneJid && !participants.includes(phoneJid)) {
                participants.push(phoneJid);
            }
        }

        // Add the sender so they are in the group
        const senderPhoneJid = toPhoneJid(senderId);
        if (senderPhoneJid && !participants.includes(senderPhoneJid)) {
            participants.push(senderPhoneJid);
        }

        // Deduplicate and remove @lid JIDs which WhatsApp rejects
        const botNum = sock.user?.id ? sock.user.id.split('@')[0].split(':')[0] : null;
        const botJid = botNum ? `${botNum}@s.whatsapp.net` : null;

        const uniqueParticipants = participants
            .filter(p => p && !p.endsWith('@lid') && p !== botJid)
            .filter((p, i, arr) => arr.indexOf(p) === i);

        await sock.sendMessage(chatId, {
            text: `⏳ Creating group *${groupName}*...`
        }, { quoted: message });

        console.log('\x1b[35m[CREATEGROUP] Creating group:', groupName, 'with', uniqueParticipants.length, 'members\x1b[0m');

        const group = await sock.groupCreate(groupName, uniqueParticipants);

        let inviteLink = '';
        try {
            const inviteCode = await sock.groupInviteCode(group.id);
            inviteLink = `\n🔗 https://chat.whatsapp.com/${inviteCode}`;
        } catch (e) {
            console.log('[CREATEGROUP] Could not fetch invite link:', e.message);
        }

        console.log('\x1b[35m[CREATEGROUP] Group created:', group.id, '\x1b[0m');

        await sock.sendMessage(chatId, {
            text: `✅ Group *${groupName}* created successfully!\n👥 Members: ${uniqueParticipants.length + 1}${inviteLink}`
        }, { quoted: message });

        // Welcome message inside the new group
        await sock.sendMessage(group.id, {
            text: `👋 Welcome to *${groupName}*! This group was created by the bot.`
        });

    } catch (err) {
        console.error('\x1b[35m[CREATEGROUP] Error:\x1b[0m', err.message);
        await sock.sendMessage(chatId, {
            text: `❌ Failed to create group: ${err?.message || 'Unknown error'}`
        }, { quoted: message });
    }
}

module.exports = { createGroupCommand };
