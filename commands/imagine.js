const axios = require('axios');
const fs = require('fs');
const path = require('path');

const { createFakeContact } = require('../lib/fakeContact');
async function imagineCommand(sock, chatId, message) {
    try {
        // Send initial reaction
        await sock.sendMessage(chatId, {
            react: { text: '🎨', key: message.key }
        });

        const text = message.message?.conversation || 
                     message.message?.extendedTextMessage?.text || 
                     message.message?.imageMessage?.caption || 
                     '';
        
        if (!text.includes(' ')) {
            return await sock.sendMessage(chatId, {
                text: '🎨 *Flux AI Image Generator*\n\n❌ Please provide a prompt for image generation!\n\n📝 *Usage:*\n.imagine a beautiful sunset over mountains\n.flux cute cat wearing glasses\n.imageai futuristic city at night\n\n🔍 *Examples:*\n• .imagine cyberpunk street\n• .imagine fantasy castle\n• .imagine anime character'
            }, { quoted: createFakeContact(message) });
        }

        const parts = text.split(' ');
        const prompt = parts.slice(1).join(' ').trim();

        if (!prompt) {
            return await sock.sendMessage(chatId, {
                text: '🎨 *Flux AI Image Generator*\n\n❌ Please provide a prompt for image generation!\n\n📝 *Example:*\n.imagine a beautiful sunset over mountains'
            }, { quoted: createFakeContact(message) });
        }

        if (prompt.length > 500) {
            return await sock.sendMessage(chatId, {
                text: '🎨 *Flux AI Image Generator*\n\n📝 Prompt too long! Max 500 characters.\n\n💡 Try a more concise description.'
            }, { quoted: createFakeContact(message) });
        }

        // Update presence to "recording" (generating)
        await sock.sendPresenceUpdate('recording', chatId);

        // Call Flux API with arraybuffer response
        const apiUrl = `https://apiskeith.vercel.app/ai/flux?q=${encodeURIComponent(prompt)}`;
        const response = await axios.get(apiUrl, {
            responseType: 'arraybuffer',
            timeout: 45000 // 45 seconds for image generation
        });

        // Generate unique filename
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(2, 8);
        const filename = `flux_${timestamp}_${randomStr}.jpg`;
        const tempDir = './temp';
        const filePath = path.join(tempDir, filename);

        // Create temp directory if it doesn't exist
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Save image temporarily
        fs.writeFileSync(filePath, response.data);

        // Send success reaction
        await sock.sendMessage(chatId, {
            react: { text: '✅', key: message.key }
        });

        // Send the generated image
        await sock.sendMessage(chatId, {
            image: { url: filePath },
            caption: `🎨 *Flux AI Image Generator*\n\n📝 *Prompt:* ${prompt}\n\n🖼️ *AI Generated Image*\n\n> Powered by Keith's Flux AI`
        }, { quoted: createFakeContact(message) });

        // Send final reaction
        await sock.sendMessage(chatId, {
            react: { text: '🖼️', key: message.key }
        });

        // Clean up temp file after sending
        setTimeout(() => {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`Cleaned up temp file: ${filename}`);
                }
            } catch (cleanupErr) {
                console.error('Error cleaning up temp file:', cleanupErr);
            }
        }, 10000); // Clean up after 10 seconds

    } catch (error) {
        console.error("Flux AI command error:", error);
        
        // Send error reaction
        await sock.sendMessage(chatId, {
            react: { text: '❌', key: message.key }
        });

        let errorMessage;
        if (error.response?.status === 404) {
            errorMessage = 'Flux AI API endpoint not found!';
        } else if (error.message.includes('timeout') || error.code === 'ECONNABORTED') {
            errorMessage = 'Image generation timed out! Try a simpler prompt.';
        } else if (error.code === 'ENOTFOUND') {
            errorMessage = 'Cannot connect to Flux AI service!';
        } else if (error.response?.status === 429) {
            errorMessage = 'Too many image generation requests! Please wait.';
        } else if (error.response?.status >= 500) {
            errorMessage = 'Flux AI service is currently unavailable.';
        } else if (error.code === 'ENOSPC') {
            errorMessage = 'Insufficient disk space to save image!';
        } else if (error.message.includes('arraybuffer')) {
            errorMessage = 'Invalid image data received from Flux AI.';
        } else {
            errorMessage = `Error: ${error.message}`;
        }
            
        await sock.sendMessage(chatId, {
            text: `🎨 *Flux AI Image Generator*\n\n🚫 ${errorMessage}\n\n💡 *Tips:*\n• Try a different prompt\n• Check your internet connection\n• Wait a few minutes and try again`
        }, { quoted: createFakeContact(message) });
    }
}

module.exports = imagineCommand;
