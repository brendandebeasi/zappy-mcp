#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { z } from 'zod';
import QRCode from 'qrcode';
import open from 'open';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(homedir(), '.config', 'zappy-mcp');
const AUTH_PATH = join(DATA_DIR, 'auth');

let configPath = null;
let waClient = null;
let isReady = false;
let isInitializing = false;
let lastQR = null;
let qrServer = null;
let allowedRecipients = [];
let suppressWarnings = false;

function parseArgs() {
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--config' && args[i + 1]) {
            configPath = args[i + 1];
        }
    }
}

function loadConfig() {
    if (!configPath) {
        console.error('[Zappy MCP] No --config specified. Use: node index.js --config /path/to/config.json');
        console.error('[Zappy MCP] Running without config - send/read blocked, but list_chats works for setup');
        return;
    }
    if (!existsSync(configPath)) {
        console.error(`[Zappy MCP] Config not found: ${configPath}`);
        return;
    }
    try {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        allowedRecipients = config.allowed || [];
        suppressWarnings = config.suppressWarnings || false;
        
        if (allowedRecipients.length === 0 && !suppressWarnings) {
            console.error('[Zappy MCP] WARNING: No allowed recipients configured.');
            console.error('[Zappy MCP] Use list_chats to find chat IDs, then add them to your config');
        } else {
            console.error(`[Zappy MCP] Loaded ${allowedRecipients.length} allowed recipients from ${configPath}`);
        }
    } catch (err) {
        console.error('[Zappy MCP] Failed to load config:', err.message);
    }
}

function getRecipient(chatId) {
    const normalized = chatId.includes('@') ? chatId : `${chatId.replace(/\D/g, '')}@c.us`;
    return allowedRecipients.find(r => r.id === normalized);
}

function canSend(chatId) {
    const recipient = getRecipient(chatId);
    return recipient && recipient.canSend !== false;
}

function canRead(chatId) {
    const recipient = getRecipient(chatId);
    return recipient && recipient.canRead !== false;
}

function canDelete(chatId) {
    const recipient = getRecipient(chatId);
    return recipient && recipient.canDelete === true;
}

function getAllowedList() {
    return allowedRecipients.map(r => ({
        id: r.id,
        name: r.name || 'Unknown',
        canSend: r.canSend !== false,
        canRead: r.canRead !== false,
        canDelete: r.canDelete === true
    }));
}

async function findAvailablePort(startPort = 3000) {
    return new Promise((resolve) => {
        const server = createServer();
        server.listen(startPort, () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', () => {
            resolve(findAvailablePort(startPort + 1));
        });
    });
}

async function startQRServer(qrData) {
    if (qrServer) return;

    const port = await findAvailablePort();
    const qrDataUrl = await QRCode.toDataURL(qrData, { width: 300, margin: 2 });

    const html = `<!DOCTYPE html>
<html>
<head>
    <title>WhatsApp QR Code</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #075e54 0%, #128c7e 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .card {
            background: white;
            border-radius: 16px;
            padding: 40px;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 400px;
        }
        h1 {
            color: #075e54;
            font-size: 24px;
            margin-bottom: 8px;
        }
        .subtitle {
            color: #667781;
            font-size: 14px;
            margin-bottom: 24px;
        }
        .qr-container {
            background: #f0f2f5;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 24px;
        }
        .qr-container img {
            display: block;
            margin: 0 auto;
        }
        .instructions {
            text-align: left;
            background: #f0f2f5;
            border-radius: 8px;
            padding: 16px;
        }
        .instructions h2 {
            font-size: 14px;
            color: #075e54;
            margin-bottom: 12px;
        }
        .instructions ol {
            color: #3b4a54;
            font-size: 13px;
            padding-left: 20px;
        }
        .instructions li {
            margin-bottom: 8px;
        }
        .status {
            margin-top: 20px;
            padding: 12px;
            border-radius: 8px;
            font-size: 13px;
        }
        .status.waiting {
            background: #fff3cd;
            color: #856404;
        }
        .status.connected {
            background: #d4edda;
            color: #155724;
        }
    </style>
</head>
<body>
    <div class="card">
        <h1>Zappy MCP</h1>
        <p class="subtitle">Scan to connect WhatsApp</p>
        <div class="qr-container">
            <img src="${qrDataUrl}" alt="QR Code" width="260" height="260">
        </div>
        <div class="instructions">
            <h2>How to connect:</h2>
            <ol>
                <li>Open WhatsApp on your phone</li>
                <li>Tap <strong>Menu</strong> or <strong>Settings</strong></li>
                <li>Tap <strong>Linked Devices</strong></li>
                <li>Tap <strong>Link a Device</strong></li>
                <li>Point your phone at this QR code</li>
            </ol>
        </div>
        <div id="status" class="status waiting">
            Waiting for connection...
        </div>
    </div>
    <script>
        setInterval(async () => {
            try {
                const res = await fetch('/status');
                const data = await res.json();
                const el = document.getElementById('status');
                if (data.connected) {
                    el.className = 'status connected';
                    el.textContent = 'Connected! This window will close automatically...';
                    setTimeout(() => window.close(), 1500);
                }
            } catch (e) {}
        }, 1000);
    </script>
</body>
</html>`;

    qrServer = createServer((req, res) => {
        if (req.url === '/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ connected: isReady }));
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
        }
    });

    qrServer.listen(port, () => {
        const url = `http://localhost:${port}`;
        console.error(`[Zappy MCP] Opening browser for QR code: ${url}`);
        open(url);
    });
}

function stopQRServer() {
    if (qrServer) {
        qrServer.close();
        qrServer = null;
        console.error('[Zappy MCP] QR server closed');
    }
}

async function ensureWhatsAppClient() {
    // Already ready
    if (isReady) return true;
    
    // Already initializing, wait for it
    if (isInitializing) {
        const maxWait = 60000; // 60 seconds max
        const start = Date.now();
        while (isInitializing && !isReady && Date.now() - start < maxWait) {
            await new Promise(r => setTimeout(r, 500));
        }
        return isReady;
    }
    
    // Start initialization
    isInitializing = true;
    console.error('[Zappy MCP] Initializing WhatsApp client (lazy)...');
    
    mkdirSync(AUTH_PATH, { recursive: true });
    console.error(`[Zappy MCP] Auth data: ${AUTH_PATH}`);
    
    waClient = new Client({
        authStrategy: new LocalAuth({
            dataPath: AUTH_PATH
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        }
    });

    return new Promise((resolve) => {
        waClient.on('qr', (qr) => {
            lastQR = qr;
            console.error('[Zappy MCP] QR code received, opening browser...');
            startQRServer(qr);
        });

        waClient.on('authenticated', () => {
            console.error('[Zappy MCP] Authenticated successfully');
            lastQR = null;
        });

        waClient.on('auth_failure', (msg) => {
            console.error('[Zappy MCP] Authentication failed:', msg);
            isReady = false;
            isInitializing = false;
            resolve(false);
        });

        waClient.on('ready', async () => {
            console.error('[Zappy MCP] Client connected, waiting for sync...');
            lastQR = null;
            setTimeout(stopQRServer, 3000);
            await new Promise(r => setTimeout(r, 5000));
            isReady = true;
            isInitializing = false;
            console.error('[Zappy MCP] Client is ready');
            resolve(true);
        });

        waClient.on('disconnected', (reason) => {
            console.error('[Zappy MCP] Client disconnected:', reason);
            isReady = false;
            isInitializing = false;
        });

        waClient.initialize().catch((err) => {
            console.error('[Zappy MCP] Failed to initialize:', err.message);
            isInitializing = false;
            resolve(false);
        });
    });
}

function formatToWhatsAppId(phone) {
    if (phone.includes('@g.us') || phone.includes('@c.us')) {
        return phone;
    }
    const digitsOnly = phone.replace(/\D/g, '');
    return `${digitsOnly}@c.us`;
}

async function main() {
    parseArgs();
    loadConfig();

    const server = new McpServer({
        name: 'zappy-mcp',
        version: '1.0.0'
    });

    server.tool(
        'get_status',
        'Check WhatsApp client connection status. Client initializes lazily on first use.',
        {},
        async () => {
            const status = {
                connected: isReady,
                initializing: isInitializing,
                clientCreated: waClient !== null,
                pendingQR: lastQR !== null,
                configPath: configPath || 'none',
                allowedRecipients: allowedRecipients.length,
                authPath: AUTH_PATH,
                message: isReady 
                    ? 'WhatsApp client is connected and ready'
                    : isInitializing
                        ? 'WhatsApp client is initializing...'
                        : lastQR 
                            ? 'Waiting for QR code scan - browser should have opened'
                            : waClient === null
                                ? 'WhatsApp client not started yet (will init on first tool use)'
                                : 'WhatsApp client is not connected'
            };

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(status, null, 2)
                }]
            };
        }
    );

    server.tool(
        'list_allowed',
        'List all allowed recipients with their permissions (canSend, canRead)',
        {},
        async () => {
            const allowed = getAllowedList();
            const response = {
                total: allowed.length,
                recipients: allowed,
                configPath: configPath || 'none'
            };
            
            if (allowed.length === 0) {
                response.setup = 'No recipients configured. Use list_chats to find chat IDs, then add them to your config file';
            }
            
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(response, null, 2)
                }]
            };
        }
    );

    server.tool(
        'list_chats',
        'List all WhatsApp chats with their IDs and permissions. Use this to find chat IDs for config.json setup.',
        {
            limit: z.number().optional().describe('Maximum number of chats to return (default: 50)'),
            groupsOnly: z.boolean().optional().describe('Only show group chats (default: false)')
        },
        async ({ limit = 50, groupsOnly = false }) => {
            const ready = await ensureWhatsAppClient();
            if (!ready) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ 
                            error: 'WhatsApp client failed to initialize. Check status with get_status tool.' 
                        })
                    }],
                    isError: true
                };
            }

            try {
                let chats = await waClient.getChats();
                if (groupsOnly) {
                    chats = chats.filter(c => c.isGroup);
                }
                const chatList = chats.slice(0, limit).map(chat => {
                    const recipient = getRecipient(chat.id._serialized);
                    return {
                        id: chat.id._serialized,
                        name: chat.name || chat.id.user,
                        isGroup: chat.isGroup,
                        canSend: recipient ? recipient.canSend !== false : false,
                        canRead: recipient ? recipient.canRead !== false : false,
                        canDelete: recipient ? recipient.canDelete === true : false,
                        unreadCount: chat.unreadCount
                    };
                });

                const response = {
                    total: chats.length,
                    returned: chatList.length,
                    chats: chatList
                };
                
                if (allowedRecipients.length === 0 && !suppressWarnings) {
                    response.warning = 'No recipients configured yet. Copy chat IDs from above and add to config.json to enable send/read.';
                }

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(response, null, 2)
                    }]
                };
            } catch (err) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ error: err.message })
                    }],
                    isError: true
                };
            }
        }
    );

    server.tool(
        'send_message',
        'Send a WhatsApp message to an ALLOWED phone number or group. Will fail if recipient is not in the allowed list.',
        {
            to: z.string().describe('Phone number (with country code) or group ID - must be in allowed list'),
            message: z.string().describe('Message text to send')
        },
        async ({ to, message }) => {
            const ready = await ensureWhatsAppClient();
            if (!ready) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ 
                            error: 'WhatsApp client failed to initialize. Check status with get_status tool.' 
                        })
                    }],
                    isError: true
                };
            }

            const chatId = formatToWhatsAppId(to);

            if (!canSend(chatId)) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ 
                            error: 'Not allowed to send to this recipient',
                            recipient: chatId,
                            hint: 'Add this recipient to config.json with canSend: true',
                            allowedRecipients: getAllowedList()
                        }, null, 2)
                    }],
                    isError: true
                };
            }

            try {
                const result = await waClient.sendMessage(chatId, message);
                
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            messageId: result.id._serialized,
                            to: chatId,
                            timestamp: result.timestamp
                        }, null, 2)
                    }]
                };
            } catch (err) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ 
                            error: err.message,
                            hint: 'Make sure the phone number includes country code and is registered on WhatsApp'
                        })
                    }],
                    isError: true
                };
            }
        }
    );

    server.tool(
        'get_messages',
        'Get recent messages from a chat. Only works for chats with canRead permission.',
        {
            chatId: z.string().describe('Chat ID (from list_chats) or phone number'),
            limit: z.number().optional().describe('Number of messages to fetch (default: 20)')
        },
        async ({ chatId, limit = 20 }) => {
            const ready = await ensureWhatsAppClient();
            if (!ready) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ 
                            error: 'WhatsApp client failed to initialize. Check status with get_status tool.' 
                        })
                    }],
                    isError: true
                };
            }

            const formattedId = formatToWhatsAppId(chatId);

            if (!canRead(formattedId)) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ 
                            error: 'Not allowed to read messages from this chat',
                            chatId: formattedId,
                            hint: 'Add this chat to config.json with canRead: true'
                        }, null, 2)
                    }],
                    isError: true
                };
            }

            try {
                const chat = await waClient.getChatById(formattedId);
                const messages = await chat.fetchMessages({ limit });

                const messageList = messages.map(msg => ({
                    id: msg.id._serialized,
                    from: msg.from,
                    fromMe: msg.fromMe,
                    body: msg.body,
                    timestamp: msg.timestamp,
                    type: msg.type,
                    hasMedia: msg.hasMedia
                }));

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            chatId: formattedId,
                            chatName: chat.name,
                            messages: messageList
                        }, null, 2)
                    }]
                };
            } catch (err) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ error: err.message })
                    }],
                    isError: true
                };
            }
        }
    );

    server.tool(
        'delete_message',
        'Delete a message. Requires canDelete permission. Can only delete messages sent by you.',
        {
            chatId: z.string().describe('Chat ID where the message is'),
            messageId: z.string().describe('Message ID to delete (from get_messages)'),
            forEveryone: z.boolean().optional().describe('Delete for everyone, not just me (default: true)')
        },
        async ({ chatId, messageId, forEveryone = true }) => {
            const ready = await ensureWhatsAppClient();
            if (!ready) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ 
                            error: 'WhatsApp client failed to initialize. Check status with get_status tool.' 
                        })
                    }],
                    isError: true
                };
            }

            const formattedId = formatToWhatsAppId(chatId);

            if (!canDelete(formattedId)) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ 
                            error: 'Not allowed to delete messages in this chat',
                            chatId: formattedId,
                            hint: 'Add this chat to config with canDelete: true'
                        }, null, 2)
                    }],
                    isError: true
                };
            }

            try {
                const chat = await waClient.getChatById(formattedId);
                const messages = await chat.fetchMessages({ limit: 50 });
                const message = messages.find(m => m.id._serialized === messageId);

                if (!message) {
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({ 
                                error: 'Message not found',
                                messageId,
                                hint: 'Use get_messages to find valid message IDs'
                            })
                        }],
                        isError: true
                    };
                }

                if (!message.fromMe) {
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({ 
                                error: 'Can only delete messages sent by you',
                                messageId
                            })
                        }],
                        isError: true
                    };
                }

                await message.delete(forEveryone);

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            messageId,
                            deletedForEveryone: forEveryone
                        }, null, 2)
                    }]
                };
            } catch (err) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ error: err.message })
                    }],
                    isError: true
                };
            }
        }
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    console.error('[Zappy MCP] Server started');
}

main().catch((err) => {
    console.error('[Zappy MCP] Fatal error:', err);
    process.exit(1);
});
