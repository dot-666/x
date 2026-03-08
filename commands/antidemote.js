const { 
    setAntidemote, 
    getAntidemote, 
    removeAntidemote,
    revertLastAction,
    addKickRecord,
    getKickStats,
    incrementProtectedCount,
    addBannedUser,
    removeBannedUser,
    isUserBanned,
    ensureDataDir
} = require('../lib/antidemote-file');
const isAdmin = require('../lib/isAdmin');

const { createFakeContact } = require('../lib/fakeContact');
async function antidemoteCommand(sock, chatId, message, senderId) {
    try {
        await ensureDataDir();
        const isSenderAdmin = await isAdmin(sock, chatId, senderId);

        if (!isSenderAdmin) {
            await sock.sendMessage(chatId, { text: '❌ For Group Admins Only' }, { quoted: createFakeContact(message) });
            return;
        }

        const text = message.message?.conversation || 
                    message.message?.extendedTextMessage?.text || 
                    message.message?.imageMessage?.caption || '';
        const args = text.trim().split(' ').slice(1);
        const action = args[0]?.toLowerCase();
        const config = await getAntidemote(chatId);

        if (!action) {
            const usage = `🛡️ *ANTIDEMOTE COMMANDS*\n\n` +
                `• .antidemote on - Enable protection\n` +
                `• .antidemote off - Disable protection\n` +
                `• .antidemote status - Check status\n` +
                `• .antidemote revert - Undo last action\n` +
                `• .antidemote kick @user - Remove member\n` +
                `• .antidemote ban @user - Ban member\n` +
                `• .antidemote unban @user - Unban member\n` +
                `• .antidemote stats - View statistics`;
            await sock.sendMessage(chatId, { text: usage }, { quoted: createFakeContact(message) });
            return;
        }

        switch (action) {
            case 'on':
                await setAntidemote(chatId, 'on', senderId);
                await sock.sendMessage(chatId, { 
                    text: '🛡️ *Antidemote Activated*\n\n✅ Admins are now protected from demotion!\n❌ No one can demote group admins.' 
                }, { quoted: createFakeContact(message) });
                break;

            case 'off':
                await removeAntidemote(chatId, senderId);
                await sock.sendMessage(chatId, { 
                    text: '❌ *Antidemote Deactivated*\n\n⚠️ Admins can now be demoted normally.' 
                }, { quoted: createFakeContact(message) });
                break;

            case 'status':
            case 'get':
                const statusConfig = await getAntidemote(chatId);
                const statusText = `🛡️ *ANTIDEMOTE STATUS*\n\n` +
                    `📌 Group: ${chatId.split('@')[0]}\n` +
                    `🔰 Status: ${statusConfig.enabled ? '✅ ACTIVE' : '❌ INACTIVE'}\n` +
                    `🛡️ Protections: ${statusConfig.protectedCount || 0}\n` +
                    `👢 Total Kicks: ${statusConfig.kickCount || 0}\n` +
                    `📅 Last Updated: ${statusConfig.updatedAt ? new Date(statusConfig.updatedAt).toLocaleString() : 'Never'}\n\n` +
                    `${statusConfig.enabled ? '🟢 Admins are protected from demotion' : '🔴 No protection active'}`;
                await sock.sendMessage(chatId, { text: statusText }, { quoted: createFakeContact(message) });
                break;

            case 'revert':
            case 'undo':
                const revertResult = await revertLastAction(chatId);
                await sock.sendMessage(chatId, { 
                    text: `🔄 *REVERT ${revertResult.success ? 'SUCCESSFUL' : 'FAILED'}*\n\n${revertResult.message}` 
                }, { quoted: createFakeContact(message) });
                break;

            case 'kick':
                if (!args[1]) {
                    await sock.sendMessage(chatId, { 
                        text: '❌ Please mention the user to kick.\n\n📝 *Usage:* `.antidemote kick @user`' 
                    }, { quoted: createFakeContact(message) });
                    return;
                }

                const mentionedKick = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || (args[1].includes('@') ? args[1].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!mentionedKick) {
                    await sock.sendMessage(chatId, { 
                        text: '❌ Please mention a valid user with @.' 
                    }, { quoted: createFakeContact(message) });
                    return;
                }

                // Check if target is admin
                const groupMetadataKick = await sock.groupMetadata(chatId);
                const targetIsAdmin = groupMetadataKick.participants.find(p => p.id === mentionedKick)?.admin;
                
                if (targetIsAdmin && config.enabled) {
                    await sock.sendMessage(chatId, { 
                        text: '🛡️ *ANTIDEMOTE PROTECTION*\n\n❌ Cannot kick admins while antidemote is enabled!\n⚠️ Disable antidemote first with `.antidemote off`' 
                    }, { quoted: createFakeContact(message) });
                    return;
                }

                if (mentionedKick === senderId) {
                    await sock.sendMessage(chatId, { 
                        text: '❌ You cannot kick yourself!' 
                    }, { quoted: createFakeContact(message) });
                    return;
                }

                try {
                    await sock.groupParticipantsUpdate(chatId, [mentionedKick], 'remove');
                    await addKickRecord(chatId, mentionedKick, senderId, 'manual');
                    
                    await sock.sendMessage(chatId, { 
                        text: `👢 *USER KICKED*\n\n✅ @${mentionedKick.split('@')[0]} has been removed from the group.\n👮 Kicked by: @${senderId.split('@')[0]}`,
                        mentions: [mentionedKick, senderId]
                    }, { quoted: createFakeContact(message) });
                } catch (kickError) {
                    await sock.sendMessage(chatId, { 
                        text: '❌ Failed to kick user. Make sure I am an admin!' 
                    }, { quoted: createFakeContact(message) });
                }
                break;

            case 'ban':
                if (!args[1]) {
                    await sock.sendMessage(chatId, { 
                        text: '❌ Please mention the user to ban.\n\n📝 *Usage:* `.antidemote ban @user`' 
                    }, { quoted: createFakeContact(message) });
                    return;
                }

                const mentionedBan = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || (args[1].includes('@') ? args[1].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!mentionedBan) {
                    await sock.sendMessage(chatId, { 
                        text: '❌ Please mention a valid user with @.' 
                    }, { quoted: createFakeContact(message) });
                    return;
                }

                // Check if target is admin
                const groupMetadataBan = await sock.groupMetadata(chatId);
                const targetIsAdminBan = groupMetadataBan.participants.find(p => p.id === mentionedBan)?.admin;
                
                if (targetIsAdminBan && config.enabled) {
                    await sock.sendMessage(chatId, { 
                        text: '🛡️ *ANTIDEMOTE PROTECTION*\n\n❌ Cannot ban admins while antidemote is enabled!\n⚠️ Disable antidemote first with `.antidemote off`' 
                    }, { quoted: createFakeContact(message) });
                    return;
                }

                if (mentionedBan === senderId) {
                    await sock.sendMessage(chatId, { 
                        text: '❌ You cannot ban yourself!' 
                    }, { quoted: createFakeContact(message) });
                    return;
                }

                // Check if already banned
                const alreadyBanned = await isUserBanned(chatId, mentionedBan);
                if (alreadyBanned) {
                    await sock.sendMessage(chatId, { 
                        text: `⚠️ @${mentionedBan.split('@')[0]} is already banned.`,
                        mentions: [mentionedBan]
                    }, { quoted: createFakeContact(message) });
                    return;
                }

                try {
                    await sock.groupParticipantsUpdate(chatId, [mentionedBan], 'remove');
                    await addBannedUser(chatId, mentionedBan, senderId, 'manual');
                    await addKickRecord(chatId, mentionedBan, senderId, 'ban');
                    
                    await sock.sendMessage(chatId, { 
                        text: `🚫 *USER BANNED*\n\n✅ @${mentionedBan.split('@')[0]} has been banned from the group.\n👮 Banned by: @${senderId.split('@')[0]}\n📌 Use \`.antidemote unban\` to remove ban.`,
                        mentions: [mentionedBan, senderId]
                    }, { quoted: createFakeContact(message) });
                } catch (banError) {
                    await sock.sendMessage(chatId, { 
                        text: '❌ Failed to ban user. Make sure I am an admin!' 
                    }, { quoted: createFakeContact(message) });
                }
                break;

            case 'unban':
                if (!args[1]) {
                    await sock.sendMessage(chatId, { 
                        text: '❌ Please mention the user to unban.\n\n📝 *Usage:* `.antidemote unban @user`' 
                    }, { quoted: createFakeContact(message) });
                    return;
                }

                const mentionedUnban = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || (args[1].includes('@') ? args[1].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
                if (!mentionedUnban) {
                    await sock.sendMessage(chatId, { 
                        text: '❌ Please mention a valid user with @.' 
                    }, { quoted: createFakeContact(message) });
                    return;
                }

                const unbanned = await removeBannedUser(chatId, mentionedUnban);
                if (unbanned) {
                    await sock.sendMessage(chatId, { 
                        text: `✅ @${mentionedUnban.split('@')[0]} has been unbanned and can now join the group.`,
                        mentions: [mentionedUnban]
                    }, { quoted: createFakeContact(message) });
                } else {
                    await sock.sendMessage(chatId, { 
                        text: `❌ @${mentionedUnban.split('@')[0]} is not in the ban list.`,
                        mentions: [mentionedUnban]
                    }, { quoted: createFakeContact(message) });
                }
                break;

            case 'stats':
            case 'history':
                const stats = await getKickStats(chatId);
                const groupMetadata = await sock.groupMetadata(chatId);
                
                let statsText = `📊 *ANTIDEMOTE STATISTICS*\n\n`;
                statsText += `👥 Group: ${groupMetadata.subject}\n`;
                statsText += `🆔 ID: ${chatId.split('@')[0]}\n\n`;
                statsText += `🛡️ *Protections:* ${stats.protectedCount || 0}\n`;
                statsText += `👢 *Total Kicks:* ${stats.totalKicks}\n`;
                statsText += `🚫 *Banned Users:* ${config.bannedUsers?.filter(b => b.active).length || 0}\n\n`;
                
                if (stats.recentKicks.length > 0) {
                    statsText += `*📋 RECENT ACTIONS (Last 5):*\n`;
                    stats.recentKicks.slice(0, 5).forEach((kick, i) => {
                        const date = new Date(kick.timestamp).toLocaleString('en-US', { timeZone: 'Africa/Nairobi' });
                        const action = kick.reason === 'demote' ? '🛡️ Protected' : 
                                      kick.reason === 'ban' ? '🚫 Banned' : '👢 Kicked';
                        statsText += `${i+1}. ${action}: @${kick.userId.split('@')[0]}\n`;
                        statsText += `   👮 By: @${kick.kickedBy?.split('@')[0] || 'System'}\n`;
                        statsText += `   📅 ${date}\n\n`;
                    });
                    
                    const mentions = stats.recentKicks.slice(0, 5).flatMap(k => [k.userId, k.kickedBy]).filter(Boolean);
                    await sock.sendMessage(chatId, { 
                        text: statsText,
                        mentions: mentions
                    }, { quoted: createFakeContact(message) });
                } else {
                    statsText += `*📋 No recent actions recorded*`;
                    await sock.sendMessage(chatId, { 
                        text: statsText
                    }, { quoted: createFakeContact(message) });
                }
                break;

            default:
                await sock.sendMessage(chatId, { 
                    text: '❌ *Invalid Command*\n\nUse `.antidemote` to see all available commands.' 
                }, { quoted: createFakeContact(message) });
        }
    } catch (error) {
        console.error('Error in antidemote command:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ An error occurred while processing the command.\nPlease try again later.' 
        }, { quoted: createFakeContact(message) });
    }
}

async function handleAntidemote(sock, chatId, participants, author) {
    try {
        const config = await getAntidemote(chatId);
        if (!config.enabled) return false;

        // Check if the author (who demoted) is admin
        const authorIsAdmin = await isAdmin(sock, chatId, author);
        if (!authorIsAdmin) return false;

        // Get group participants info
        const groupMetadata = await sock.groupMetadata(chatId);
        let repromoted = false;
        
        // Only re-promote if they were admins before
        for (const participant of participants) {
            const wasAdmin = groupMetadata.participants.find(p => p.id === participant)?.admin;
            if (wasAdmin) {
                await sock.groupParticipantsUpdate(chatId, [participant], 'promote');
                await addKickRecord(chatId, participant, author, 'demote');
                await incrementProtectedCount(chatId);
                
                console.log(`[ANTIDEMOTE] Re-promoted ${participant} in ${chatId}`);
                
                // Send notification
                await sock.sendMessage(chatId, {
                    text: `🛡️ *ANTIDEMOTE ACTIVE*\n\n✅ @${participant.split('@')[0]} was re-promoted to admin.\n⚠️ ${author.split('@')[0]} tried to demote an admin!\n\n📌 Admins are protected in this group!`,
                    mentions: [participant, author]
                });
                
                repromoted = true;
            }
        }

        return repromoted;
    } catch (error) {
        console.error('Error in handleAntidemote:', error);
        return false;
    }
}

module.exports = {
    antidemoteCommand,
    handleAntidemote
};
