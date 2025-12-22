const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

// --- LOAD LIBRARY ---
let WebcastPushConnection;
try {
    WebcastPushConnection = require('./TikTok-Live-Connector-1.2.3/src/index.js').WebcastPushConnection;
} catch (e) {
    console.error("[ERROR] Gagal load library. Pastikan folder TikTok-Live-Connector-1.2.3 ada.");
    process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- KONFIGURASI FILTER ---
const BANNED_WORDS = [
    "BUNUH", "MATI", "NAJIS", "ANJING", "BABi", 
    "KONTOL", "MEMEK", "JEMBUT", "NGENTOT", "TOLOL", "BEGO",
    "GOBLOK", "SETAN", "IBLIS", "DADAH", "MAMPUS", "***"
];

// OPTIMISASI EKSTREM: Batas maksimal karakter mentah hanya 20.
// Komentar seperti "Bang tolong jawabannya itu adalah BACOK ya" (43 huruf) akan LANGSUNG DITOLAK.
// Hanya komentar seperti "BACOK", "B A C O K", atau "Jawab BACOK" yang akan diproses.
const MAX_RAW_LENGTH = 20; 

// --- STATE ---
let tiktokLiveConnection = null;
let activeTargetUser = null;

function disconnectCurrent() {
    if (tiktokLiveConnection) {
        try { tiktokLiveConnection.disconnect(); } catch (e) {}
        tiktokLiveConnection = null;
    }
}

function connectToTikTok(username) {
    if (activeTargetUser !== username) disconnectCurrent();
    activeTargetUser = username;
    
    if (tiktokLiveConnection) disconnectCurrent();

    console.log(`[SERVER] Menghubungkan ke @${username}...`);
    io.emit('status', { type: 'warning', msg: `Connecting to @${username}...` });

    tiktokLiveConnection = new WebcastPushConnection(username);

    tiktokLiveConnection.connect().then(state => {
        console.info(`[TIKTOK] TERHUBUNG! Room ID: ${state.roomId}`);
        io.emit('status', { type: 'success', msg: `LIVE: @${username}` });
    }).catch(err => {
        console.error('[TIKTOK] Gagal connect:', err.message);
        handleReconnect(username, "Gagal Konek (Retrying...)");
    });

    tiktokLiveConnection.on('chat', data => {
        const rawComment = data.comment.trim().toUpperCase();

        // --- FILTER AWAL (SANGAT KETAT) ---
        // Jika lebih dari 20 huruf, langsung return (abaikan). Hemat CPU.
        if (rawComment.length > MAX_RAW_LENGTH) return;
        
        // Filter terlalu pendek (< 3 huruf tidak mungkin jadi jawaban game)
        if (rawComment.length < 3) return;
        
        // --- LOGIKA SMART BYPASS ---
        let finalGuess = null;

        const isValidWord = (word) => {
            return word.length >= 4 && word.length <= 8 && /^[A-Z]+$/.test(word);
        };

        // STRATEGI 1: Anti-Spasi ("B A C O K" -> "BACOK")
        const noSpaceComment = rawComment.replace(/\s+/g, ''); 
        
        if (isValidWord(noSpaceComment)) {
            finalGuess = noSpaceComment;
        } 
        
        // STRATEGI 2: Detektif Kalimat Pendek ("Ini BACOK")
        if (!finalGuess) {
            const words = rawComment.split(/[\s.,!?]+/); 
            // Cari kata valid dari belakang
            for (let i = words.length - 1; i >= 0; i--) {
                if (isValidWord(words[i])) {
                    finalGuess = words[i];
                    break; 
                }
            }
        }

        // --- FINAL CHECK & EMIT ---
        if (finalGuess) {
            const isBanned = BANNED_WORDS.some(badWord => finalGuess.includes(badWord));

            if (!isBanned) {
                console.log(`[TEBAK] ${data.uniqueId}: ${finalGuess}`);
                io.emit('new_guess', {
                    username: data.uniqueId,
                    word: finalGuess,
                    picture: data.profilePictureUrl
                });
            }
        }
    });

    tiktokLiveConnection.on('gift', data => {
        if (data.giftType === 1 && !data.repeatEnd) return;
        io.emit('gift_event', {
            username: data.uniqueId,
            giftName: data.giftName,
            amount: data.repeatCount
        });
    });

    tiktokLiveConnection.on('disconnected', () => {
        handleReconnect(username, "Terputus (Reconnecting...)");
    });
}

function handleReconnect(username, msg) {
    if (activeTargetUser === username) {
        io.emit('status', { type: 'error', msg: msg });
        disconnectCurrent();
        setTimeout(() => {
            if (activeTargetUser === username) connectToTikTok(username);
        }, 5000);
    }
}

io.on('connection', (socket) => {
    if (activeTargetUser) socket.emit('status', { type: 'warning', msg: `Reconnecting: @${activeTargetUser}` });
    socket.on('change_username', (username) => {
        activeTargetUser = null;
        connectToTikTok(username);
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`\n=== SERVER ULTRA OPTIMIZED (MAX 20 CHARS) SIAP ===`);
});