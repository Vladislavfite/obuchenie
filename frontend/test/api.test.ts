import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { api } from '../src/lib/api';

// Use Fastify's real parser: an empty request with application/json is rejected
// before the route handler runs. This affects logout and publication endpoints.
test('bodyless POST reaches Fastify and JSON payloads are still parsed', async () => {
  const server = Fastify();
  server.post('/api/auth/logout', async () => ({ success: true, data: { loggedOut: true } }));
  server.post('/api/training/modules/example/publish', async () => ({ success: true, data: { published: true } }));
  server.post('/api/example', async (request) => ({ success: true, data: request.body }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const reply = await server.inject({ method: init?.method as 'POST', url: String(input), headers: init?.headers as Record<string, string>, payload: init?.body as string | undefined });
    return new Response(reply.body, { status: reply.statusCode, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    assert.deepEqual(await api.post('/api/auth/logout'), { loggedOut: true });
    assert.deepEqual(await api.post('/api/training/modules/example/publish'), { published: true });
    assert.deepEqual(await api.post('/api/example', { title: 'Обучение' }), { title: 'Обучение' });
  } finally {
    globalThis.fetch = originalFetch;
    await server.close();
  }
});
