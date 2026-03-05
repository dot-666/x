const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");

async function trimCommand(sock, chatId, message) {
    try {
        // React to command
        await sock.sendMessage(chatId, { react: { text: "✂️", key: message.key } });

        // Prepare temp directory
        const tempDir = path.join(os.tmpdir(), "june-x-temp");
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        // Extract query
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        const args = text?.split(" ").slice(1).map(t => t.trim());

        if (!args || args.length < 2) {
            return sock.sendMessage(chatId, {
                text: "❌ Reply to an audio or video file with start and end time.\n\nExample: `trim 0:10 0:30`"
            }, { quoted: message });
        }

        const [startTime, endTime] = args;
        if (!startTime || !endTime) {
            return sock.sendMessage(chatId, {
                text: "⚠️ Invalid format.\n\nExample: `trim 0:10 0:30`"
            }, { quoted: message });
        }

        // Check quoted media
        const quotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const mediaType = quotedMsg?.audioMessage || quotedMsg?.videoMessage;
        if (!mediaType) {
            return sock.sendMessage(chatId, {
                text: "❌ Unsupported media type. Quote an audio or video file."
            }, { quoted: message });
        }

        // Download media
        const mediaPath = await sock.downloadAndSaveMediaMessage({ message: mediaType });
        const isAudio = !!quotedMsg.audioMessage;
        const outputExt = isAudio ? ".mp3" : ".mp4";
        const outputPath = path.join(tempDir, `trim_${Date.now()}${outputExt}`);

        // Run ffmpeg
        await new Promise((resolve, reject) => {
            exec(`ffmpeg -i "${mediaPath}" -ss ${startTime} -to ${endTime} -c copy "${outputPath}"`, (err) => {
                fs.unlinkSync(mediaPath);
                if (err) return reject(err);
                resolve();
            });
        });

        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
            throw new Error("Trimming failed or empty file!");
        }

        // Notify user
        await sock.sendMessage(chatId, { text: `_✂️ Trimmed clip ready!_` });

        // Send trimmed media
        const buffer = fs.readFileSync(outputPath);
        const messageContent = isAudio
            ? { audio: buffer, mimetype: "audio/mpeg", fileName: "trimmed.mp3" }
            : { video: buffer, mimetype: "video/mp4", fileName: "trimmed.mp4" };

        await sock.sendMessage(chatId, messageContent, { quoted: message });

        // Cleanup
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

    } catch (error) {
        console.error("Trim command error:", error);
        return sock.sendMessage(chatId, {
            text: `🚫 Error: ${error.message}`
        }, { quoted: message });
    }
}

module.exports = trimCommand;
