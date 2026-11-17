import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';

describe('API docs', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp(loadEnv());
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the Swagger UI at /docs', async () => {
    const res = await request(app.server).get('/docs').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('serves a valid OpenAPI document with the expected routes and security scheme', async () => {
    const res = await request(app.server).get('/docs/json').expect(200);

    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.info.title).toBe('Slotly API');
    expect(res.body.components.securitySchemes.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });

    const paths = Object.keys(res.body.paths as Record<string, unknown>);
    for (const expected of [
      '/health',
      '/auth/register',
      '/auth/login',
      '/providers',
      '/providers/{id}',
      '/providers/me/availability-rules',
      '/providers/{id}/slots',
      '/bookings',
      '/bookings/{id}/cancel',
    ]) {
      expect(paths).toContain(expected);
    }
  });

  it('marks an authenticated route as requiring bearer auth, and a public one as not', async () => {
    const res = await request(app.server).get('/docs/json').expect(200);

    expect(res.body.paths['/bookings'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(res.body.paths['/providers'].get.security).toBeUndefined();
  });
});
