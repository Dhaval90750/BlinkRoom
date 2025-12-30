const socket = io({ autoConnect: false });

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const activeUsersTrigger = document.getElementById('active-users-trigger');
const userListPanel = document.getElementById('user-list-panel');
const logsPanel = document.getElementById('logs-panel');
const usernameInput = document.getElementById('username');
const roomIdInput = document.getElementById('room-id');
const joinBtn = document.getElementById('join-btn');
const loginError = document.getElementById('login-error');

const messageList = document.getElementById('message-list');
const logsList = document.getElementById('logs-list');
const usersUl = document.getElementById('users-ul');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const uploadBtn = document.getElementById('upload-btn');
const photoInput = document.getElementById('photo-input');
const toggleLogsBtn = document.getElementById('toggle-logs-btn');
const vanishTimerSelect = document.getElementById('vanish-timer');
const typingIndicator = document.getElementById('typing-indicator');
const flashModal = document.getElementById('flash-modal');
const flashImage = document.getElementById('flash-image');
const closeModal = document.querySelector('.close-modal');

// State
let myId = '';
let myUsername = '';
let typingTimeout = null;
let idleTimeout = null;
let isIdle = false;

// --- LISTENERS ---

joinBtn.addEventListener('click', () => {
    const user = usernameInput.value.trim();
    const room = roomIdInput.value.trim();
    
    if (!user || !room) {
        loginError.textContent = "Display Name and Room ID are required.";
        return;
    }



    socket.connect();
    socket.emit('joinRoom', { username: user, roomId: room });
});

// UI Toggles
toggleLogsBtn.addEventListener('click', () => {
    logsPanel.classList.toggle('hidden');
    userListPanel.classList.add('hidden');
});
activeUsersTrigger.addEventListener('click', () => {
    userListPanel.classList.toggle('hidden');
    logsPanel.classList.add('hidden');
});
document.getElementById('leave-btn').addEventListener('click', () => location.reload());

// Sending
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => { 
    if (e.key === 'Enter') sendMessage(); 
});

// Typing Detection
messageInput.addEventListener('input', () => {
    socket.emit('typingStart');
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typingStop');
    }, 1000);
});

// Idle Detection
function resetIdleTimer() {
    if (isIdle) {
        isIdle = false;
        socket.emit('statusChange', 'online');
    }
    clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => {
        isIdle = true;
        socket.emit('statusChange', 'idle');
    }, 60000); // 60s idle
}
document.addEventListener('mousemove', resetIdleTimer);
document.addEventListener('keydown', resetIdleTimer);

// FlashPic
uploadBtn.addEventListener('click', () => photoInput.click());
photoInput.addEventListener('change', () => {
    const file = photoInput.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => socket.emit('sendFlashPic', e.target.result);
        reader.readAsDataURL(file);
    }
});
closeModal.addEventListener('click', () => {
    flashModal.classList.add('hidden');
    flashImage.src = '';
});

// --- SOCKET EVENTS ---

socket.on('connect', () => { 
    myId = socket.id;
    loginError.textContent = ''; 
});

socket.on('loginFailed', (msg) => {
    loginError.textContent = msg;
    socket.disconnect(); 
});

socket.on('joined', (data) => {
    myUsername = data.username; // Capture assigned name (NameGuard)
    document.getElementById('room-display').textContent = `Room: ${data.roomId} (Server: ${data.serverInstance})`;
    
    // Render existing logs
    logsList.innerHTML = '';
    data.logs.forEach(addLogEntry);

    loginScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    resetIdleTimer(); // Start tracking
});

socket.on('updateUserList', (users) => {
    document.getElementById('user-count').textContent = users.length;
    usersUl.innerHTML = users.map(u => `
        <li>
            <div class="status-dot ${u.status}" title="${u.status.toUpperCase()}"></div>
            ${u.username} ${u.username === myUsername ? '(You)' : ''} 
            <span style="font-size:0.75em; color:#888; margin-left:6px; font-weight:normal;">(${u.status})</span>
        </li>
    `).join('');
});

socket.on('typingUpdate', ({ username, isTyping }) => {
    if (isTyping) {
        typingIndicator.textContent = `${username} is typing...`;
        typingIndicator.classList.remove('hidden');
    } else {
        typingIndicator.classList.add('hidden');
    }
});

socket.on('message', (msg) => {
    appendMessage(msg);
    if (msg.senderId !== myId) socket.emit('markRead', msg.id);
});

socket.on('messageVanished', (msgId) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 500); // Fade out then remove
    }
});

socket.on('messageRead', (msgId) => {
    const el = document.getElementById(`status-${msgId}`);
    if (el) {
        el.textContent = '✓✓';
        el.classList.add('read');
    }
});

socket.on('roomLog', addLogEntry);

socket.on('flashPicContent', ({ msgId, data }) => {
    flashImage.src = data;
    flashModal.classList.remove('hidden');
    
    // Mark as viewed in UI
    const btn = document.getElementById(`fp-btn-${msgId}`);
    if (btn) {
        btn.textContent = "Already Viewed 👁️";
        btn.disabled = true;
        btn.style.opacity = '0.6';
        btn.style.cursor = 'not-allowed';
    }
});
socket.on('flashPicError', (err) => alert(err.error));

// --- HELPERS ---

function sendMessage() {
    const text = messageInput.value;
    if (text.trim()) {
        const timer = parseInt(vanishTimerSelect.value);
        socket.emit('chatMessage', { text, vanishTimer: timer });
        messageInput.value = '';
        socket.emit('typingStop');
    }
}

function appendMessage(msg) {
    const div = document.createElement('div');
    div.id = `msg-${msg.id}`;
    div.classList.add('message');
    if (msg.senderId === myId) div.classList.add('my-message');

    let content = '';
    if (msg.type === 'text') content = `<div class="msg-content">${escapeHtml(msg.content)}</div>`;
    else if (msg.type === 'flashpic') {
        content = msg.senderId === myId 
            ? '<i>You sent a FlashPic</i> 📸' 
            : `<button id="fp-btn-${msg.id}" class="icon-btn" onclick="viewFlashPic('${msg.id}')">View FlashPic 📸</button>`;
    }

    const timerIcon = msg.vanishTimer > 0 ? `<i class="fas fa-hourglass-half vanish-icon" title="Vanishes in ${msg.vanishTimer}s"></i>` : '';
    const receipt = msg.senderId === myId ? `<span id="status-${msg.id}" class="receipt">✓</span>` : '';

    div.innerHTML = `
        <div class="msg-header">
            <span>${msg.senderId === myId ? 'You' : msg.username}</span>
            <span>${msg.time} ${timerIcon} ${receipt}</span>
        </div>
        ${content}
    `;
    messageList.appendChild(div);
    messageList.scrollTop = messageList.scrollHeight;
}

function addLogEntry(log) {
    // 1. Sidebar Log (Existing)
    const li = document.createElement('li');
    li.innerHTML = `<span style="color:var(--primary)">${log.user || 'System'}</span> ${log.action} <span style="font-size:0.7em; opacity:0.7">${log.time}</span>`;
    logsList.appendChild(li);

    // 2. Chat System Message (New) - Filtered
    // Only show important presence events in the main chat
    const allowedActions = ['joined the room', 'left the room'];
    if (allowedActions.some(act => log.action.includes(act))) {
        const div = document.createElement('div');
        div.classList.add('system-message');
        div.innerHTML = `
            <span style="font-weight:bold; color:var(--primary)">${log.user || 'System'}</span> 
            ${log.action} 
            <span style="opacity:0.6; margin-left:5px;">${log.time}</span>
        `;
        messageList.appendChild(div);
        messageList.scrollTop = messageList.scrollHeight;
    }
}

window.viewFlashPic = (id) => socket.emit('viewFlashPic', id);
function escapeHtml(text) { return text.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','':'&quot;',"'":'&#039;'}[m])); }
