/**
 * BluSlate web server — Fastify HTTP + Socket.IO for real-time pipeline events.
 *
 * Serves the built Svelte client as static files and provides:
 *   - HTTP API routes for settings, directory browsing, ffprobe, filenames, undo
 *   - Socket.IO for pipeline lifecycle (start, cancel, progress, prompts)
 *
 * Security:
 *   - @fastify/helmet adds X-Frame-Options, X-Content-Type-Options, HSTS, etc.
 *   - @fastify/cors locks cross-origin requests to the server's own origin.
 *   - Set BLUSLATE_PASSWORD to enable HTTP Basic Auth and Socket.IO token auth.
 */

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyHelmet from '@fastify/helmet';
import fastifyCors from '@fastify/cors';
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
const PASSWORD = process.env.BLUSLATE_PASSWORD;

function getPort(): number {
  const raw = parseInt(process.env.PORT || '3000', 10);
  if (!Number.isFinite(raw) || raw < 1 || raw > 65535) {
    console.error(`Error: PORT="${process.env.PORT}" is invalid (must be 1-65535), using 3000`);
    return 3000;
  }
  return raw;
}

const PORT = getPort();

/** Verify a constant-time string comparison to prevent timing attacks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  // Security headers (CSP disabled — Svelte SPA may use inline styles/scripts from Vite build)
  await app.register(fastifyHelmet, { contentSecurityPolicy: false });

  // CORS: deny cross-origin requests (all UI is served from the same origin)
  await app.register(fastifyCors, { origin: false });

  // Optional HTTP Basic Auth guard — active when BLUSLATE_PASSWORD is set
  if (PASSWORD) {
    app.addHook('onRequest', async (request, reply) => {
      // Pass through Socket.IO upgrade handshake — Socket.IO auth handles it separately
      if (request.url.startsWith('/socket.io/')) return;

      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Basic ')) {
        reply.header('WWW-Authenticate', 'Basic realm="BluSlate"');
        return reply.status(401).send({ error: 'Authentication required' });
      }

      const credentials = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
      const colonIdx = credentials.indexOf(':');
      const suppliedPassword = colonIdx >= 0 ? credentials.slice(colonIdx + 1) : credentials;

      if (!safeEqual(suppliedPassword, PASSWORD)) {
        reply.header('WWW-Authenticate', 'Basic realm="BluSlate"');
        return reply.status(401).send({ error: 'Invalid credentials' });
      }
    });

    app.log.info('Basic Auth enabled (BLUSLATE_PASSWORD is set)');
  }

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

  // Socket.IO auth middleware — enforces BLUSLATE_PASSWORD if set
  if (PASSWORD) {
    io.use((socket, next) => {
      const supplied = socket.handshake.auth?.password as string | undefined;
      if (typeof supplied !== 'string' || !safeEqual(supplied, PASSWORD)) {
        return next(new Error('Authentication required'));
      }
      next();
    });
  }

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
