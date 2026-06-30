/**
 * WhatsApp Filter Bot - VIP Edition V2 (Plug & Play)
 * 100% English & Arabic Edition - FIXED: Multi-Session, Pairing Code, & Bugs
 * + Real-time reporting for numbers without WA (1-tap copy)
 * + Max Speed Restored (Batch 25 / 150ms)
 * + Anti-Crash & Anti-Hang System
 * + Anti-Duplicate Messages System (Per Chat Fixed)
 * + Auto-Delete Pairing Messages on Success
 * + [NEW] Ban Notification System
 * + [NEW] Fix Errors Button
 * + [NEW] Auto Keep-Alive System (Render Fix)
 */

const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, Browsers } = require("@whiskeysockets/baileys");
const TelegramBot = require('node-telegram-bot-api');
const pino = require('pino');
const express = require('express');
const fs = require('fs').promises;
const fsSync = require('fs');
const axios = require('axios');
const path = require('path');

// --- إعداد مجلد الجلسات المتعددة ---
const SESSIONS_DIR = './sessions';
if (!fsSync.existsSync(SESSIONS_DIR)) {
    fsSync.mkdirSync(SESSIONS_DIR);
}

// --- Bot Settings ---
const token = '8871251608:AAGn3SN9LVGy2YLkpq7nx2o77kCxmnOX9KY'; // ضع توكن البوت الخاص بك
const RENDER_URL = 'https://bot-3siq.onrender.com'; // رابط الاستضافة الخاص بك

// --- Express Server to keep the bot alive ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('WhatsApp Filter Bot is Running 🟢 (VIP Edition V2) - Awake!'));
app.listen(port, () => console.log(`🌐 [SERVER] Server is now running on port: ${port}`));

// --- نظام منع السكون (Keep-Alive) للاستضافات المجانية ---
setInterval(async () => {
    try {
        await axios.get(RENDER_URL);
        console.log('✅ [KEEP-ALIVE] Pinged successfully, bot is kept awake.');
    } catch (error) {
        console.log('⚠️ [KEEP-ALIVE] Failed to ping:', error.message);
    }
}, 50 * 1000); // تم التعديل: يقوم بزيارة الرابط كل 50 ثانية (50,000 ملي ثانية)

const bot = new TelegramBot(token, { polling: true });

// ==========================================
// 🛡️ ANTI-CRASH SYSTEM
// ==========================================
bot.on('polling_error', (error) => console.log(`⚠️ [Polling Warning]: ${error.code} - Bot is still running...`));
bot.on('error', (error) => console.log(`⚠️ [Bot Error]: ${error.message}`));
process.on('unhandledRejection', (reason) => console.log('⚠️ [Unhandled Rejection]:', reason));
process.on('uncaughtException', (error) => console.log('⚠️ [Uncaught Exception]:', error.message));

// ==========================================
// 🛡️ ANTI-DUPLICATE SYSTEM (FIXED)
// ==========================================
const processedUpdates = new Set();
function isDuplicate(uniqueId) {
    if (!uniqueId) return false;
    if (processedUpdates.has(uniqueId)) return true;
    processedUpdates.add(uniqueId);
    if (processedUpdates.size > 2000) {
        const arr = Array.from(processedUpdates);
        processedUpdates.clear();
        arr.slice(1000).forEach(val => processedUpdates.add(val));
    }
    return false;
}

// ==========================================
// --- User State Management ---
const userStates = new Map();
function getUserState(chatId) {
    if (!userStates.has(chatId)) {
        userStates.set(chatId, {
            sock: null,
            queue: [],
            isProcessing: false,
            stopSignal: false,
            waitingForPair: false,
            notOnWa: [],
            pairingMessages: []
        });
    }
    return userStates.get(chatId);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- Initialize WhatsApp Connection (Multi-Session Support) ---
async function startWhatsApp(chatId, phoneToPair = null) {
    const state = getUserState(chatId);
    const sessionFolder = path.join(SESSIONS_DIR, `session_${chatId}`);
    
    const { state: authState, saveCreds } = await useMultiFileAuthState(sessionFolder);
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        version,
        auth: authState,
        printQRInTerminal: false,
        logger: pino({ level: 'error' }),
        browser: Browsers.ubuntu('Chrome'), 
    });

    state.sock = sock;
    sock.ev.on('creds.update', saveCreds);

    if (phoneToPair && !sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneToPair);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                
                const msg = await bot.sendMessage(chatId, `✅ *Pairing code generated successfully!*\n\nاضغط على الكود للنسخ:\n\`${code}\`\n\n📌 *Activation steps:*\n1. Open WhatsApp on your phone.\n2. Go to Linked Devices.\n3. Select "Link a device".\n4. Select "Link with phone number instead".\n5. Enter the code above 👆`, { parse_mode: 'Markdown' });
                state.pairingMessages.push(msg.message_id);
            } catch (e) {
                bot.sendMessage(chatId, `❌ *Failed to request code!*\nReason: The number might be invalid or WhatsApp servers blocked the request temporarily.\nError: ${e.message}`, { parse_mode: 'Markdown' });
            }
        }, 2000);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'open') {
            console.log(`✅ [WHATSAPP] User ${chatId} connected!`);
            bot.sendMessage(chatId, "✅ *تمت عملية الربط بنجاح! البوت مستعد الآن لبدء الفحص.* 🎉", { parse_mode: 'Markdown' });
            if (state.pairingMessages.length > 0) {
                for (let msgId of state.pairingMessages) {
                    bot.deleteMessage(chatId, msgId).catch(() => {});
                }
                state.pairingMessages = [];
            }
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            
            if (reason === DisconnectReason.loggedOut) {
                console.log(`🚪 [WHATSAPP] User ${chatId} logged out.`);
                await fs.rm(sessionFolder, { recursive: true, force: true }).catch(() => {});
                state.sock = null;
                bot.sendMessage(chatId, "🚪 *تم إلغاء ربط رقم الهاتف بالبوت بنجاح.*\nيمكنك الآن ربط رقم هاتف جديد باستخدام الأمر /pair", { parse_mode: 'Markdown' });
            } else if (reason === 403) {
                console.log(`🚨 [WHATSAPP] User ${chatId} NUMBER BANNED!`);
                await fs.rm(sessionFolder, { recursive: true, force: true }).catch(() => {});
                state.sock = null;
                bot.sendMessage(chatId, "🚨 *تنبيه هام جداً!* 🚨\n\n⚠️ *يبدو أن الرقم المرتبط بالبوت قد تعرض للحظر من قبل شركة واتساب!* ❌\n\nتم مسح الجلسة تلقائياً للحماية. يرجى استخدام رقم آخر والمحاولة مرة أخرى.", { parse_mode: 'Markdown' });
            } else {
                console.log(`♻️ [WHATSAPP] Reconnecting ${chatId}... (Reason Code: ${reason})`);
                setTimeout(() => startWhatsApp(chatId), 2000);
            }
        }
    });
}

// --- استعادة جلسات المستخدمين عند تشغيل السيرفر ---
async function restoreSessions() {
    const dirs = await fs.readdir(SESSIONS_DIR).catch(() => []);
    for (const dir of dirs) {
        if (dir.startsWith('session_')) {
            const chatId = dir.split('_')[1];
            startWhatsApp(chatId);
        }
    }
}
restoreSessions();

// --- Logout Function ---
async function handleLogout(chatId) {
    const state = getUserState(chatId);
    const sock = state.sock;
    const sessionFolder = path.join(SESSIONS_DIR, `session_${chatId}`);

    if (sock?.ws?.isOpen && sock?.user) {
        bot.sendMessage(chatId, "⏳ *جاري تسجيل الخروج وإلغاء الربط...*", { parse_mode: 'Markdown' });
        try {
            await Promise.race([
                sock.logout(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
            ]);
        } catch (err) {
            bot.sendMessage(chatId, `❌ *Error during logout:*\n${err.message}`, { parse_mode: 'Markdown' });
        }
    } else {
        bot.sendMessage(chatId, "⚠️ *لا يوجد اتصال نشط، لكن يتم تنظيف جلستك...*", { parse_mode: 'Markdown' });
        await fs.rm(sessionFolder, { recursive: true, force: true }).catch(() => {});
        state.sock = null;
        bot.sendMessage(chatId, "🚪 *تم إلغاء ربط رقم الهاتف بالبوت ومسح الجلسة.*\nيمكنك الآن ربط رقم هاتف جديد باستخدام الأمر /pair", { parse_mode: 'Markdown' });
    }
}

// --- Fast Scan System ---
async function processQueue(chatId) {
    const state = getUserState(chatId);
    const sock = state.sock;

    if (state.isProcessing) return;
    
    if (!sock?.ws?.isOpen) {
        bot.sendMessage(chatId, "❌ *Bot is not connected to WhatsApp.*\nLink a number first using the (🔗 Link WhatsApp) button.", { parse_mode: 'Markdown' });
        return;
    }

    state.isProcessing = true;
    state.stopSignal = false;
    state.notOnWa = [];
    
    let current = 0;
    let lastUpdateTime = Date.now();
    let statusMsg;
    
    try {
        statusMsg = await bot.sendMessage(chatId, `⏳ *Starting quick scan...* 🚀`, { parse_mode: 'Markdown' });
    } catch (e) {
        state.isProcessing = false;
        return;
    }

    const BATCH_SIZE = 25; 

    while (state.queue.length > 0 && !state.stopSignal) {
        if (!state.sock?.ws?.isOpen) {
            await sleep(3000); 
            continue; 
        }

        let total = current + state.queue.length;
        const batch = state.queue.splice(0, BATCH_SIZE);
        
        const promises = batch.map(async (number) => {
            const cleanNumber = number.replace(/[^0-9]/g, '');
            if (cleanNumber.length >= 8 && cleanNumber.length <= 15) {
                try {
                    const result = await Promise.race([
                        state.sock.onWhatsApp(cleanNumber),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
                    ]);
                    
                    const waData = result?.[0];
                    if (!waData || !waData.exists) {
                        state.notOnWa.push(`+${cleanNumber}`);
                        bot.sendMessage(chatId, `❌ ليس على واتساب (اضغط للنسخ):\n\`+${cleanNumber}\``, { parse_mode: 'Markdown' }).catch(() => {});
                    }
                } catch (e) {}
            }
        });

        await Promise.all(promises);
        current += batch.length;
        
        if (Date.now() - lastUpdateTime > 2000 || state.queue.length === 0) {
            const percent = Math.min(100, Math.floor((current / total) * 100));
            const progress = "🟩".repeat(Math.floor(percent / 10)) + "⬜".repeat(10 - Math.floor(percent / 10));
            
            await bot.editMessageText(
                `⚡ *Scan in progress...*\n\n📊 *Progress:* \n${progress} *${percent}%*\n\n✅ *Scanned:* ${current} of ${total}\n❌ *Numbers without WhatsApp:* ${state.notOnWa.length}`,
                { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' }
            ).catch(() => {});
            
            lastUpdateTime = Date.now();
        }
        
        await sleep(150); 
    }

    state.isProcessing = false;
    let finalTotal = current;

    if (state.stopSignal) {
        state.queue = []; 
        bot.sendMessage(chatId, "🛑 *Scan stopped manually.*", { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(chatId, "🏁 *Scan completed!* 🎉", { parse_mode: 'Markdown' });
    }

    if (state.notOnWa.length > 0) {
        const fileName = `results_${chatId}_${Date.now()}.txt`;
        await fs.writeFile(fileName, "Numbers without WhatsApp accounts:\n\n" + state.notOnWa.join('\n'));
        await bot.sendDocument(chatId, fileName, { 
            caption: `📈 *Total scanned:* ${finalTotal}\n❌ *Numbers without WhatsApp:* ${state.notOnWa.length}\n\nThe attached file contains all numbers without WhatsApp.`, 
            parse_mode: 'Markdown' 
        });
        await fs.unlink(fileName).catch(() => {});
    } else if (!state.stopSignal && finalTotal > 0) {
        bot.sendMessage(chatId, "✅ All sent numbers have active WhatsApp accounts.", { parse_mode: 'Markdown' });
    }
}

// --- Commands and Messages Handling ---
bot.setMyCommands([
    { command: 'start', description: '🏠 Main Menu' },
    { command: 'pair', description: '🔗 Link WhatsApp number' },
    { command: 'status', description: '📊 Connection Status' },
    { command: 'logout', description: '🚪 Logout' },
    { command: 'cancel', description: '🛑 Stop Scan' },
    { command: 'reset', description: '🔄 Reset Bot Session (Fix Bugs)' }
]);

bot.on('message', async (msg) => {
    if (isDuplicate(`${msg.chat.id}_${msg.message_id}`)) return;
    
    const chatId = msg.chat.id;
    const text = msg.text || msg.caption || '';
    const state = getUserState(chatId);

    if (text === '/reset') {
        const sessionFolder = path.join(SESSIONS_DIR, `session_${chatId}`);
        bot.sendMessage(chatId, "🔄 *Resetting session and clearing cache...*", { parse_mode: 'Markdown' });
        await fs.rm(sessionFolder, { recursive: true, force: true }).catch(() => {});
        state.sock = null;
        bot.sendMessage(chatId, "✅ *System completely reset. Send /pair to link your number again.*", { parse_mode: 'Markdown' });
        return;
    }

    if (text === '/start') {
        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "▶️ Start Scan", callback_data: 'start_scan' }],
                    [{ text: "🔗 Link WhatsApp", callback_data: 'pair_wa' }, { text: "🚪 Logout", callback_data: 'logout_wa' }],
                    [{ text: "📊 Connection Status", callback_data: 'status_wa' }, { text: "🛑 Stop Scan", callback_data: 'cancel_scan' }],
                    [{ text: "🛠️ إصلاح الأعطال (Reset)", callback_data: 'reset_bot' }], 
                    [{ text: "🔌 تنشيط البوت (إذا توقف)", url: "https://bot-3siq.onrender.com" }]
                ]
            }
        };
        bot.sendMessage(chatId, "👑 *Welcome to Auto Filter Bot (VIP)* 👑\n\nPlease select an action from the menu below:\n\n_ملاحظة: إذا توقف البوت عن الرد، اضغط على زر التنشيط بالأسفل._", { parse_mode: 'Markdown', ...opts });
        return;
    }

    if (text === '/pair') {
        if (state.sock?.ws?.isOpen && state.sock?.user) {
            bot.sendMessage(chatId, "⚠️ *You are already connected to a WhatsApp number.*\nUse /logout first if you want to change the number.", { parse_mode: 'Markdown' });
            return;
        }
        state.waitingForPair = true;
        state.pairingMessages.push(msg.message_id); 
        const m = await bot.sendMessage(chatId, "📲 *Send the WhatsApp number now in international format*\n*(Example: 967712345678 or 201012345678)*\n\n⚠️ _Without + or leading zeros_", { parse_mode: 'Markdown' });
        state.pairingMessages.push(m.message_id);
        return;
    }

    if (text === '/cancel') {
        state.stopSignal = true;
        bot.sendMessage(chatId, "🛑 *Stopping scan...*", { parse_mode: 'Markdown' });
        return;
    }
    
    if (text === '/status') {
        const status = state.sock?.ws?.isOpen ? `✅ *Status:* Connected\n📱 *Number:* +${state.sock.user?.id.split(':')[0]}` : "❌ *Status:* Disconnected";
        bot.sendMessage(chatId, status, { parse_mode: 'Markdown' });
        return;
    }

    if (text === '/logout') {
        await handleLogout(chatId);
        return;
    }

    if (state.waitingForPair && !text.startsWith('/')) {
        state.waitingForPair = false;
        state.pairingMessages.push(msg.message_id); 
        
        let phone = text.replace(/[^0-9]/g, '');
        if (phone.startsWith('00')) phone = phone.substring(2); 
        
        if (phone.length < 8) {
            const m = await bot.sendMessage(chatId, "❌ *Invalid number!* Please send a valid number in international format.", { parse_mode: 'Markdown' });
            state.pairingMessages.push(m.message_id);
            return;
        }
        
        const m = await bot.sendMessage(chatId, `⏳ *Requesting pairing code for number:* \`${phone}\`...`, { parse_mode: 'Markdown' });
        state.pairingMessages.push(m.message_id);
        
        await startWhatsApp(chatId, phone);
        return;
    }

    if (msg.document && msg.document.file_name && msg.document.file_name.endsWith('.txt')) {
        bot.sendMessage(chatId, "⏳ *Reading file and extracting numbers...*", { parse_mode: 'Markdown' });
        try {
            const fileLink = await bot.getFileLink(msg.document.file_id);
            const response = await axios.get(fileLink);
            const dataStr = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
            const numbers = dataStr.match(/\d+/g);
            
            if (numbers && numbers.length > 0) {
                state.queue = state.queue.concat(numbers);
                bot.sendMessage(chatId, `📩 *Extracted ${numbers.length} numbers from file.*\n🚀 Starting scan immediately...`, { parse_mode: 'Markdown' });
                processQueue(chatId);
            } else {
                bot.sendMessage(chatId, "⚠️ *No valid numbers found in the file.*", { parse_mode: 'Markdown' });
            }
        } catch (error) {
            bot.sendMessage(chatId, "❌ *Failed to read file.* Make sure it's a valid .txt file.", { parse_mode: 'Markdown' });
        }
        return;
    }

    const numbers = text.match(/\d+/g);
    if (numbers && !text.startsWith('/')) {
        state.queue = state.queue.concat(numbers);
        bot.sendMessage(chatId, `📩 *Received ${numbers.length} numbers.*\n🚀 Starting scan...`, { parse_mode: 'Markdown' });
        processQueue(chatId);
    }
});

bot.on('callback_query', async (query) => {
    if (isDuplicate(`${query.message.chat.id}_${query.id}`)) return;
    
    const chatId = query.message.chat.id;
    const data = query.data;
    const state = getUserState(chatId);

    if (data === 'start_scan') {
        bot.sendMessage(chatId, "📩 *How to scan:*\nSend numbers directly here as a message, or upload a `.txt` file containing the numbers.", { parse_mode: 'Markdown' });
        bot.answerCallbackQuery(query.id);
    } else if (data === 'status_wa') {
        const status = state.sock?.ws?.isOpen ? `✅ *Status:* Connected\n📱 *Number:* +${state.sock.user?.id.split(':')[0]}` : "❌ *Status:* Disconnected";
        bot.answerCallbackQuery(query.id, { text: state.sock?.ws?.isOpen ? "Connected ✅" : "Disconnected ❌", show_alert: true });
        bot.sendMessage(chatId, status, { parse_mode: 'Markdown' });
    } else if (data === 'logout_wa') {
        await handleLogout(chatId);
        bot.answerCallbackQuery(query.id, { text: "Logout requested 🚪" });
    } else if (data === 'pair_wa') {
        state.waitingForPair = true;
        const m = await bot.sendMessage(chatId, "📲 *Send the WhatsApp number now in international format*\n*(Example: 967712345678)*\n\n⚠️ _Without + or leading zeros_", { parse_mode: 'Markdown' });
        state.pairingMessages.push(m.message_id);
        bot.answerCallbackQuery(query.id);
    } else if (data === 'cancel_scan') {
        state.stopSignal = true;
        bot.answerCallbackQuery(query.id, { text: "🛑 Stopping scan..." });
    } else if (data === 'reset_bot') {
        const sessionFolder = path.join(SESSIONS_DIR, `session_${chatId}`);
        bot.sendMessage(chatId, "🔄 *جاري إصلاح الأعطال ومسح الجلسة القديمة...*", { parse_mode: 'Markdown' });
        await fs.rm(sessionFolder, { recursive: true, force: true }).catch(() => {});
        state.sock = null;
        state.isProcessing = false;
        state.queue = [];
        state.stopSignal = true;
        bot.sendMessage(chatId, "✅ *تم إصلاح الأعطال وإعادة ضبط البوت بالكامل. يرجى ربط رقمك من جديد عبر زر (🔗 Link WhatsApp).* 🚀", { parse_mode: 'Markdown' });
        bot.answerCallbackQuery(query.id, { text: "تم الإصلاح بنجاح 🛠️", show_alert: true });
    }
});
