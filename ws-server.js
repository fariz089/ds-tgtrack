// ws-server.js
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

const clients = new Set();

wss.on('connection', ws => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

function broadcastDSM(alarm, alarmType, speed) {
  const data = { type: 'dsm', alarm, alarmType, speed };
  clients.forEach(c => c.send(JSON.stringify(data)));
}

module.exports = { broadcastDSM };