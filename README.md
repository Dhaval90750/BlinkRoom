# BlinkRoom V2 <i class="fas fa-bolt"></i>

A real-time messaging application with ephemeral features, now upgraded with V2 capabilities.

## New V2 Features 🚀

- **VanishText**: Send self-destructing messages (10s, 30s, 1m). Messages disappear from all screens automatically.
- **PulseStatus**: User presence tracking. See who is **Online** (Green) or **Idle** (Gray) in the new Active Users panel.
- **EchoTyping**: See real-time "username is typing..." indicators.
- **NameGuard**: Auto-handles duplicate usernames (e.g., "Alex" -> "Alex (2)").

## Core Features

- **FlashPic**: Send photos that can be viewed only **once**.
- **Read Receipts**: Track message delivery (`✓`) and read status (`✓✓`).
- **Room Logs**: Sidebar panel tracks user joins, leaves, and activity.
- **Memory-Only**: No database, maximum privacy.

## How to Run

1. Navigate to directory:
   ```bash
   cd blink-room
   ```
2. Start server:
   ```bash
   node server.js
   ```
3. Open [http://localhost:3000](http://localhost:3000).

## Usage Tips

- **Vanish Messages**: Select a timer (10s/30s/1m) from the dropdown next to the input box before sending.
- **View Users**: Click the user count in the header to toggle the Active Users list.
- **Logs**: Click the History icon to see room events.
