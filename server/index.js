'use strict';

const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('./db');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bistro.db');

const db = openDatabase(DB_PATH);
const app = createApp(db);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Bistro Digital POS listo.`);
  console.log(`  En este equipo:   http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) console.log(`  En la red local:  http://${net.address}:${PORT}`);
    }
  }
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
