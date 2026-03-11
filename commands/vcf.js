const fs = require('fs');
const path = require('path');
const { jidDecode } = require('@whiskeysockets/baileys');
const { resolvePhoneFromLid } = require('../lib/jid');
const pino = require('pino')({ level: 'silent' });

const { createFakeContact } = require('../lib/fakeContact');
function decodeJid(jid) {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
        const decoded = jidDecode(jid);
        return decoded.user && decoded.server ? `${decoded.user}@${decoded.server}` : jid;
    }
    return jid;
}

async function vcfCommand(sock, chatId, message) {
    let loadingMsg = null;
    
    try {
        if (!chatId.endsWith('@g.us')) {
            return await sock.sendMessage(chatId, {
                text: '❌ This command only works in groups!'
            }, { quoted: createFakeContact(message) });
        }

        // Send loading message
        loadingMsg = await sock.sendMessage(chatId, {
            text: '⏳ Generating VCF file... This may take a moment for large groups.'
        }, { quoted: createFakeContact(message) });

        const groupMetadata = await sock.groupMetadata(chatId);
        const participants = groupMetadata.participants || [];

        if (participants.length < 2) {
            // Delete loading message
            if (loadingMsg) {
                await sock.sendMessage(chatId, {
                    delete: loadingMsg.key
                });
            }
            
            return await sock.sendMessage(chatId, {
                text: '❌ Group must have at least 2 members'
            }, { quoted: createFakeContact(message) });
        }

        let vcfContent = '';
        let validCount = 0;
        const seenNumbers = new Set();
        const batchSize = 100; // Process in batches to avoid memory issues
        let processedCount = 0;
        const totalParticipants = participants.length;

        // Update loading message with progress
        const updateProgress = async () => {
            if (loadingMsg && processedCount % 50 === 0) {
                const percent = Math.round((processedCount / totalParticipants) * 100);
                try {
                    await sock.sendMessage(chatId, {
                        text: `⏳ Processing group members: ${processedCount}/${totalParticipants} (${percent}%)\nValid numbers found: ${validCount}`,
                        edit: loadingMsg.key
                    });
                } catch (e) {
                    // Ignore edit errors
                }
            }
        };

        // Process participants in batches
        for (let i = 0; i < participants.length; i += batchSize) {
            const batch = participants.slice(i, i + batchSize);
            
            for (const participant of batch) {
                processedCount++;
                
                if (!participant.id) continue;

                const decodedId = decodeJid(participant.id);
                let number = decodedId.split('@')[0].replace(/\D/g, '');

                if (decodedId.endsWith('@lid')) {
                    const numOnly = decodedId.split('@')[0];
                    const resolved = resolvePhoneFromLid(numOnly);
                    if (resolved) {
                        number = resolved.replace(/\D/g, '');
                    } else {
                        continue;
                    }
                }

                if (!number || number.length < 7) continue;

                if (seenNumbers.has(number)) continue;
                seenNumbers.add(number);

                if (number.startsWith('0')) {
                    number = `263${number.replace(/^0+/, '')}`;
                }

                const name = participant.name || participant.notify || `Member ${validCount + 1}`;

                vcfContent +=
`BEGIN:VCARD
VERSION:3.0
FN:${name}
TEL;TYPE=CELL:+${number}
NOTE:From ${groupMetadata.subject}
END:VCARD
`;
                validCount++;
                
                // Small delay to prevent rate limiting
                if (validCount % 100 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
            
            // Update progress after each batch
            await updateProgress();
            
            // Force garbage collection if needed (Node.js will handle this automatically)
            if (global.gc && processedCount % 500 === 0) {
                global.gc();
            }
        }

        // Delete loading message
        if (loadingMsg) {
            await sock.sendMessage(chatId, {
                delete: loadingMsg.key
            });
        }

        if (validCount === 0) {
            return await sock.sendMessage(chatId, {
                text: '❌ No valid phone numbers found in this group!'
            }, { quoted: createFakeContact(message) });
        }

        // Show file preparation message
        await sock.sendMessage(chatId, {
            text: `✅ Found ${validCount} valid numbers. Preparing VCF file...`
        }, { quoted: createFakeContact(message) });

        const tempDir = path.join(__dirname, '../tmp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const safeName = groupMetadata.subject.replace(/[^\w]/g, '_');
        const filePath = path.join(tempDir, `${safeName}_${Date.now()}.vcf`);

        // Write file with better memory handling for large files
        const writeStream = fs.createWriteStream(filePath);
        writeStream.write(vcfContent.trim());
        
        await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
            writeStream.end();
        });

        // Read file in chunks for large files
        const fileSize = fs.statSync(filePath).size;
        const fileBuffer = fileSize > 100 * 1024 * 1024 // If > 100MB
            ? fs.createReadStream(filePath)
            : fs.readFileSync(filePath);

        await sock.sendMessage(chatId, {
            document: fileBuffer,
            mimetype: 'text/vcard',
            fileName: `${safeName}_contacts.vcf`,
            caption: `✅ Generated ${validCount} contacts from "${groupMetadata.subject}"`
        }, { quoted: createFakeContact(message) });

        // Clean up
        fs.unlinkSync(filePath);
        
        // Clear vcfContent to free memory
        vcfContent = null;

    } catch (err) {
        console.error('VCF COMMAND ERROR:', err);
        
        // Delete loading message if it exists
        if (loadingMsg) {
            try {
                await sock.sendMessage(chatId, {
                    delete: loadingMsg.key
                });
            } catch (e) {
                // Ignore deletion errors
            }
        }
        
        await sock.sendMessage(chatId, {
            text: '❌ Failed to generate VCF file! Error: ' + (err.message || 'Unknown error')
        }, { quoted: createFakeContact(message) });
    }
}

module.exports = vcfCommand;
