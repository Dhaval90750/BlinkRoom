const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    maxHttpBufferSize: 1e7,
    cors: { origin: "*" } // Allow all origins for debugging
});

const INSTANCE_ID = Math.random().toString(36).substr(2, 6).toUpperCase();
console.log(`[Init] Server Instance Created: ${INSTANCE_ID}`);

app.use(express.static(path.join(__dirname, 'public')));


// --- DATA STRUCTURES ---

// Map<RoomID, RoomObject>
const rooms = new Map();

// Map<SocketID, { username, room, status: 'online'|'idle', lastActive: timestamp }>
const users = new Map();

// --- HELPERS ---

function formatTime() {
    return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function generateId() {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

function getRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            users: new Set(),
            logs: [],
            flashPics: new Map(),
            pendingReceipts: new Map()
        });
        addRoomLog(roomId, 'Room created');
    }
    return rooms.get(roomId);
}

function addRoomLog(roomId, text, user = null) {
    const room = rooms.get(roomId);
    if (!room) return;
    const logEntry = {
        action: text,
        user: user ? user.username : null,
        time: formatTime()
    };
    room.logs.push(logEntry);
    io.to(roomId).emit('roomLog', logEntry);
}

function destroyRoomIfEmpty(roomId) {
    const room = rooms.get(roomId);
    if (room && room.users.size === 0) {
        rooms.delete(roomId);
        console.log(`[Destroy] Room ${roomId} destroyed.`);
    }
}

// --- SOCKET LOGIC ---

io.on('connection', (socket) => {
    
    // JOIN
    socket.on('joinRoom', ({ username, roomId }) => {
        if (!username || !roomId) return socket.emit('error', 'Invalid input');
        
        const cleanRoom = roomId.trim().toLowerCase(); // Normalize room ID
        const baseName = username.trim();



        // 2. Ensure room exists or create
        const room = getRoom(cleanRoom);

        // 3. Strict Unique Name Check
        let isDuplicate = false;
        room.users.forEach(sid => {
            const u = users.get(sid);
            if (u && u.username.toLowerCase() === baseName.toLowerCase()) {
                isDuplicate = true;
            }
        });

        if (isDuplicate) {
             return socket.emit('loginFailed', `Username "${baseName}" is already taken in room ${cleanRoom}.`);
        }

        // 4. Store User
        users.set(socket.id, { 
            username: baseName, 
            room: cleanRoom, 
            status: 'online', 
            lastActive: Date.now() 
        });
        socket.join(cleanRoom);
        room.users.add(socket.id);

        // 5. Log & Broadcast
        addRoomLog(cleanRoom, 'joined the room', { username: baseName });
        broadcastUserList(cleanRoom);
        
        // 6. Reply to client
        socket.emit('joined', { 
            username: baseName, 
            roomId: cleanRoom, 
            logs: room.logs,
            serverInstance: INSTANCE_ID 
        });
    });

    // PRESENCE / STATUS
    socket.on('statusChange', (status) => { // 'online' or 'idle'
        const user = users.get(socket.id);
        if (user) {
            user.status = status;
            broadcastUserList(user.room);
        }
    });

    // TYPING
    socket.on('typingStart', () => {
        const user = users.get(socket.id);
        if (user) socket.to(user.room).emit('typingUpdate', { username: user.username, isTyping: true });
    });
    socket.on('typingStop', () => {
        const user = users.get(socket.id);
        if (user) socket.to(user.room).emit('typingUpdate', { username: user.username, isTyping: false });
    });

    // MESSAGE (Text + Vanish)
    socket.on('chatMessage', ({ text, vanishTimer }) => {
        const user = users.get(socket.id);
        if (!user || !text.trim()) return;

        const room = rooms.get(user.room);
        const msgId = generateId();
        const time = formatTime();

        // Track Receipts
        room.pendingReceipts.set(msgId, { viewedBy: new Set([socket.id]), senderId: socket.id });

        const messageData = {
            id: msgId,
            type: 'text',
            username: user.username,
            content: text.trim(),
            time: time,
            senderId: socket.id,
            vanishTimer: vanishTimer // Seconds (0, 10, 30, 60)
        };

        io.to(user.room).emit('message', messageData);

        // Handle VanishText
        if (vanishTimer > 0) {
            setTimeout(() => {
                io.to(user.room).emit('messageVanished', msgId);
                addRoomLog(user.room, 'message vanished', user);
                if (room && room.pendingReceipts) room.pendingReceipts.delete(msgId);
            }, vanishTimer * 1000);
        }
    });

    // MARK READ
    socket.on('markRead', (msgId) => {
        const user = users.get(socket.id);
        if (!user) return;
        const room = rooms.get(user.room);
        if (!room) return;

        if (room.pendingReceipts.has(msgId)) {
            const data = room.pendingReceipts.get(msgId);
            data.viewedBy.add(socket.id);
            
            const activeUserCount = room.users.size;
            if (data.viewedBy.size >= activeUserCount) {
                io.to(user.room).emit('messageRead', msgId);
                room.pendingReceipts.delete(msgId);
            }
        }
    });

    // FLASHPIC
    socket.on('sendFlashPic', (base64) => {
        const user = users.get(socket.id);
        if (!user) return;
        const room = rooms.get(user.room);
        const msgId = generateId();
        const time = formatTime();

        // Store
        room.flashPics.set(msgId, { data: base64, viewedBy: new Set(), senderId: socket.id });
        
        // Broadcast
        const messageData = {
            id: msgId,
            type: 'flashpic',
            username: user.username,
            content: '[FlashPic]',
            time: time,
            senderId: socket.id
        };
        io.to(user.room).emit('message', messageData);
        addRoomLog(user.room, 'sent a FlashPic', user);
    });

    // VIEW FLASHPIC
    socket.on('viewFlashPic', (msgId) => {
        const user = users.get(socket.id);
        if (!user) return;
        const room = rooms.get(user.room);
        if (!room) return;

        const pic = room.flashPics.get(msgId);
        if (!pic) return socket.emit('flashPicError', { msgId, error: 'Expired or invalid.' });
        if (pic.senderId === socket.id) return socket.emit('flashPicError', { msgId, error: 'Cannot view own.' });
        if (pic.viewedBy.has(socket.id)) return socket.emit('flashPicError', { msgId, error: 'Already viewed.' });

        socket.emit('flashPicContent', { msgId, data: pic.data });
        pic.viewedBy.add(socket.id);
    });

    // DISCONNECT
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            const roomName = user.room;
            users.delete(socket.id);
            
            const room = rooms.get(roomName);
            if (room) {
                room.users.delete(socket.id);
                addRoomLog(roomName, 'left the room', user);
                broadcastUserList(roomName);
                destroyRoomIfEmpty(roomName);
            }
        }
    });

    function broadcastUserList(roomId) {
        const room = rooms.get(roomId);
        if (!room) return;
        
        const userList = [];
        room.users.forEach(sid => {
            const u = users.get(sid);
            if (u) userList.push({ username: u.username, status: u.status });
        });
        
        io.to(roomId).emit('updateUserList', userList);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`BlinkRoom V2 running on port ${PORT}`);
});
