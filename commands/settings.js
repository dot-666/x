const fs = require('fs');
const { isSudo } = require('../lib/index');
const { createFakeContact } = require('../lib/fakeContact');
const { getAntiimage } = require('../lib/database');
const { getAntisticker } = require('../lib/database');
const { getBotName } = require('../lib/botConfig');

function readJsonSafe(path, fallback) {
    try {
        const txt = fs.readFileSync(path, 'utf8');
        return JSON.parse(txt);
    } catch (_) {
        return fallback;
    }
}

async function settingsCommand(sock, chatId, message) {
    try {
        const botName = getBotName();
        const senderId = message.key.participant || message.key.remoteJid;
        if (!message.key.fromMe && !(await isSudo(senderId))) {
            await sock.sendMessage(chatId, { text: 'Only bot owner can use this command!' }, { quoted: createFakeContact(message) });
            return;
        }

        const isGroup = chatId.endsWith('@g.us');
        const dataDir = './data';

        const mode        = readJsonSafe(`${dataDir}/messageCount.json`,  { isPublic: true });
        const autoStatus  = readJsonSafe(`${dataDir}/autoStatus.json`,    { enabled: false, reactOn: false });
        const autoread    = readJsonSafe(`${dataDir}/autoread.json`,      { enabled: false });
        const autotyping  = readJsonSafe(`${dataDir}/autotyping.json`,    { enabled: false });
        const pmblocker   = readJsonSafe(`${dataDir}/pmblocker.json`,     { enabled: false });
        const anticall    = readJsonSafe(`${dataDir}/anticall.json`,      { enabled: false });
        const antidelete  = readJsonSafe(`${dataDir}/antidelete.json`,    { enabled: false, mode: 'private' });
        const autorecord  = readJsonSafe(`${dataDir}/autorecording.json`, { enabled: false });
        const prefixCfg   = readJsonSafe(`${dataDir}/prefix.json`,        { prefix: '.' });
        const menuCfg     = readJsonSafe(`${dataDir}/menuSettings.json`,  { menuStyle: '1' });

        const userGroupData = readJsonSafe(`${dataDir}/userGroupData.json`, {
            antilink: {}, antibadword: {}, welcome: {}, goodbye: {}, chatbot: {}, antitag: {}, autoReaction: { enabled: false }
        });

        const autoReactionEnabled = userGroupData.autoReaction?.enabled === true
            || (typeof userGroupData.autoReaction === 'boolean' && userGroupData.autoReaction);

        const groupId = isGroup ? chatId : null;

        const antilinkOn    = groupId ? Boolean(userGroupData.antilink    && userGroupData.antilink[groupId])    : false;
        const antibadwordOn = groupId ? Boolean(userGroupData.antibadword && userGroupData.antibadword[groupId]) : false;
        const welcomeOn     = groupId ? Boolean(userGroupData.welcome     && userGroupData.welcome[groupId])     : false;
        const goodbyeOn     = groupId ? Boolean(userGroupData.goodbye     && userGroupData.goodbye[groupId])     : false;
        const chatbotOn     = groupId ? Boolean(userGroupData.chatbot     && userGroupData.chatbot[groupId])     : false;
        const antitagCfg    = groupId ? (userGroupData.antitag  && userGroupData.antitag[groupId])  : null;

        let antiimgCfg  = null;
        let antistkrCfg = null;
        if (groupId) {
            antiimgCfg  = await getAntiimage(groupId).catch(() => null);
            antistkrCfg = await getAntisticker(groupId).catch(() => null);
        }

        const on  = (v) => v ? '✅ ON'  : '❌ OFF';
        const onS = (v) => v ? '✅ ON'  : '❌ OFF';

        const lines = [];
        lines.push('╔══════════════════════╗');
        lines.push(`║   *${botName} SETTINGS*   `);
        lines.push('╚══════════════════════╝');
        lines.push('');
        lines.push('*🌐 Global Settings*');
        lines.push(`┃ Prefix       : *${prefixCfg.prefix || '.'}*`);
        lines.push(`┃ Mode         : *${mode.isPublic ? 'Public' : 'Private'}*`);
        lines.push(`┃ Menu Style   : *Style ${menuCfg.menuStyle || '1'}*`);
        lines.push('');
        lines.push('*⚙️ Automation*');
        lines.push(`┃ Auto Status  : ${on(autoStatus.enabled)}`);
        lines.push(`┃ Status React : ${on(autoStatus.reactOn)}`);
        lines.push(`┃ Auto Read    : ${on(autoread.enabled)}`);
        lines.push(`┃ Auto Typing  : ${on(autotyping.enabled)}`);
        lines.push(`┃ Auto Record  : ${on(autorecord.enabled)}`);
        lines.push(`┃ Auto Reaction: ${on(autoReactionEnabled)}`);
        lines.push('');
        lines.push('*🛡️ Protection (Global)*');
        lines.push(`┃ PM Blocker   : ${on(pmblocker.enabled)}`);
        lines.push(`┃ Anti Call    : ${on(anticall.enabled)}`);
        lines.push(`┃ Anti Delete  : ${on(antidelete.enabled)}${antidelete.enabled ? ` (${antidelete.mode || 'private'})` : ''}`);

        if (groupId) {
            lines.push('');
            lines.push(`*👥 Group Settings*`);
            lines.push(`┃ ID: _${groupId}_`);
            lines.push('');
            lines.push('*🔗 Anti-Spam*');
            if (antilinkOn) {
                const al = userGroupData.antilink[groupId];
                lines.push(`┃ Anti Link    : ✅ ON (${al.action || 'delete'})`);
            } else {
                lines.push('┃ Anti Link    : ❌ OFF');
            }
            if (antibadwordOn) {
                const ab = userGroupData.antibadword[groupId];
                lines.push(`┃ Anti Badword : ✅ ON (${ab.action || 'delete'})`);
            } else {
                lines.push('┃ Anti Badword : ❌ OFF');
            }
            if (antitagCfg && antitagCfg.enabled) {
                lines.push(`┃ Anti Tag     : ✅ ON (${antitagCfg.action || 'delete'})`);
            } else {
                lines.push('┃ Anti Tag     : ❌ OFF');
            }
            if (antiimgCfg && antiimgCfg.enabled) {
                lines.push(`┃ Anti Image   : ✅ ON (${antiimgCfg.action || 'delete'})`);
            } else {
                lines.push('┃ Anti Image   : ❌ OFF');
            }
            if (antistkrCfg && antistkrCfg.enabled) {
                lines.push(`┃ Anti Sticker : ✅ ON (${antistkrCfg.action || 'delete'})`);
            } else {
                lines.push('┃ Anti Sticker : ❌ OFF');
            }
            lines.push('');
            lines.push('*🎉 Events*');
            lines.push(`┃ Welcome      : ${onS(welcomeOn)}`);
            lines.push(`┃ Goodbye      : ${onS(goodbyeOn)}`);
            lines.push(`┃ Chatbot      : ${onS(chatbotOn)}`);
        } else {
            lines.push('');
            lines.push('> _Run this in a group to see group-specific settings._');
        }

        lines.push('');
        lines.push('> _Thanks for choosing June MD_');

        await sock.sendMessage(chatId, { text: lines.join('\n') }, { quoted: createFakeContact(message) });
        await sock.sendMessage(chatId, {
            react: { text: '☑️', key: message.key }
        });
    } catch (error) {
        console.error('Error in settings command:', error);
        await sock.sendMessage(chatId, { text: 'Failed to read settings.' }, { quoted: createFakeContact(message) });
    }
}

module.exports = settingsCommand;
