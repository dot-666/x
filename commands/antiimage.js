const { setAntiimage, getAntiimage, removeAntiimage } = require('../lib/database');
const isAdmin = require('../lib/isAdmin');

async function antiimageCommand(sock, chatId, msg, senderId) {
  const fakeContact = (m) => {
    const id = m?.key?.participant?.split('@')[0] || m?.key?.remoteJid?.split('@')[0] || '0';
    return {
      key: { participants: "0@s.whatsapp.net", remoteJid: "0@s.whatsapp.net", fromMe: false },
      message: {
        contactMessage: {
          displayName: "JUNE-X",
          vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:JUNE-X\nTEL;waid=${id}:${id}\nEND:VCARD`
        }
      },
      participant: "0@s.whatsapp.net"
    };
  };

  const quoted = fakeContact(msg);
  try {
    const { isSenderAdmin } = await isAdmin(sock, chatId, senderId);
    if (!isSenderAdmin)
      return sock.sendMessage(chatId, { text: '❌ Admins only' }, { quoted });

    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const [action, sub] = text.trim().split(/\s+/).slice(1);
    const emoji = { delete: '🗑️', kick: '👢', warn: '⚠️' };

    switch ((action || '').toLowerCase()) {
      case 'on':
        await setAntiimage(chatId, true, 'delete');
        return sock.sendMessage(chatId, { text: '✅ Antiimage ON (Delete)\nOnly admins can send images' }, { quoted });
      case 'off':
        await removeAntiimage(chatId);
        return sock.sendMessage(chatId, { text: '❌ Antiimage OFF\nEveryone can send images' }, { quoted });
      case 'set':
        if (!['delete', 'kick', 'warn'].includes(sub))
          return sock.sendMessage(chatId, { text: '❌ Use: delete | kick | warn' }, { quoted });
        await setAntiimage(chatId, true, sub);
        return sock.sendMessage(chatId, { text: `✅ Action: ${emoji[sub]} ${sub.toUpperCase()}` }, { quoted });
      case 'status': {
        const cfg = await getAntiimage(chatId);
        return sock.sendMessage(chatId, {
          text: cfg?.enabled
            ? `✅ Antiimage ON\n${emoji[cfg.action]} ${cfg.action.toUpperCase()}\nOnly admins can send images`
            : '❌ Antiimage OFF\nUse `.antiimage on`'
        }, { quoted });
      }
      default:
        return sock.sendMessage(chatId, { text: '📸 *Antiimage Commands*\n\n• on - Enable (only admins can send images)\n• off - Disable\n• set delete|kick|warn - Set action\n• status - Check current status' }, { quoted });
    }
  } catch (e) {
    console.error('antiimageCommand error:', e);
    sock.sendMessage(chatId, { text: '❌ Error' }, { quoted });
  }
}

async function handleImageDetection(sock, chatId, msg, senderId) {
  const fakeContact = (m) => {
    const id = m?.key?.participant?.split('@')[0] || m?.key?.remoteJid?.split('@')[0] || '0';
    return {
      key: { participants: "0@s.whatsapp.net", remoteJid: "0@s.whatsapp.net", fromMe: false },
      message: {
        contactMessage: {
          displayName: "JUNE-X",
          vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:JUNE-X\nTEL;waid=${id}:${id}\nEND:VCARD`
        }
      },
      participant: "0@s.whatsapp.net"
    };
  };

  try {
    if (msg.key.fromMe) return;

    const cfg = await getAntiimage(chatId);
    if (!cfg?.enabled) return;

    const m = msg.message;
    const innerMsg = m?.viewOnceMessageV2?.message || m?.viewOnceMessage?.message || m?.documentWithCaptionMessage?.message || m;
    const isImage = !!(innerMsg?.imageMessage);
    if (!isImage) return;

    const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);
    if (isSenderAdmin) return;
    if (!isBotAdmin) return;

    const quoted = fakeContact(msg);
    try { await sock.sendMessage(chatId, { delete: msg.key }); } catch (e) { console.error('Delete fail:', e); }

    if (cfg.action === 'warn')
      await sock.sendMessage(chatId, { text: `⚠️ @${senderId.split('@')[0]} Only admins can send images`, mentions: [senderId] }, { quoted });
    else if (cfg.action === 'kick') {
      await sock.sendMessage(chatId, { text: `🚫 @${senderId.split('@')[0]} removed for sending images`, mentions: [senderId] }, { quoted });
      try { await sock.groupParticipantsUpdate(chatId, [senderId], 'remove'); } catch (e) { console.error('Kick fail:', e); }
    }
  } catch (e) {
    console.error('handleImageDetection error:', e);
  }
}

module.exports = { antiimageCommand, handleImageDetection };
