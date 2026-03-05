/**
 * BluSlate web server — Fastify HTTP + Socket.IO for real-time pipeline events.
 *
 * Serves the built Svelte client as static files and provides:
 *   - HTTP API routes for settings, directory browsing, ffprobe, filenames, undo
 *   - Socket.IO for pipeline lifecycle (start, cancel, progress, prompts)
 */

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server as SocketIOServer } from 'socket.io';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { settingsRoutes } from './routes/settings.js';
import { browseRoutes } from './routes/browse.js';
import { ffprobeRoutes, initFfprobe } from './routes/ffprobe.js';
import { filenamesRoutes } from './routes/filenames.js';
import { undoRoutes } from './routes/undo.js';
import { registerSocketHandlers } from './socket-handlers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  // Serve built Svelte client as static files
  const clientDir = join(__dirname, '../client');
  if (existsSync(clientDir)) {
    await app.register(fastifyStatic, {
      root: clientDir,
      prefix: '/',
      wildcard: false,
    });

    // SPA fallback: serve index.html for all non-API, non-file routes
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/socket.io/')) {
        return reply.status(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  // Register HTTP routes
  await app.register(settingsRoutes);
  await app.register(browseRoutes);
  await app.register(ffprobeRoutes);
  await app.register(filenamesRoutes);
  await app.register(undoRoutes);

  // Initialize ffprobe check
  await initFfprobe();

  // Start HTTP server
  await app.listen({ port: PORT, host: '0.0.0.0' });

  // Attach Socket.IO to the underlying Node HTTP server
  const io = new SocketIOServer(app.server, {
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    app.log.info(`Client connected: ${socket.id}`);
    registerSocketHandlers(socket);

    socket.on('disconnect', () => {
      app.log.info(`Client disconnected: ${socket.id}`);
    });
  });

  const mediaRoot = process.env.MEDIA_ROOT || '/media';
  app.log.info(`BluSlate web server running on http://0.0.0.0:${PORT}`);
  app.log.info(`Media root: ${mediaRoot}`);
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
