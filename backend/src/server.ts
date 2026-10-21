import path from 'node:path';
import fs from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ZodError } from 'zod';
import { MAX_FILE_BYTES } from '@tbedu/shared';
import { config } from './core/config.js';
import { AppError } from './core/errors.js';
import { fail } from './core/response.js';
import { redact } from './core/crypto.js';
import { authPlugin } from './core/context.js';

import { authRoutes } from './modules/auth/routes.js';
import { orgRoutes } from './modules/org/routes.js';
import { usersRoutes } from './modules/users/routes.js';
import { employeesRoutes } from './modules/employees/routes.js';
import { trainingRoutes } from './modules/training/routes.js';
import { assignmentsRoutes } from './modules/assignments/routes.js';
import { testingRoutes } from './modules/testing/routes.js';
import { myRoutes } from './modules/my/routes.js';
import { lecturesRoutes } from './modules/lectures/routes.js';
import { certificatesRoutes } from './modules/certificates/routes.js';
import { aiRoutes } from './modules/ai/routes.js';
import { filesRoutes } from './modules/files/routes.js';
import { onecRoutes } from './modules/onec/routes.js';
import { uiRoutes } from './modules/ui/routes.js';
import { auditRoutes } from './modules/audit/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { healthRoutes } from './modules/health/routes.js';

/* Собранный фронтенд ищем и относительно backend, и относительно корня:
   каталог запуска отличается в разработке и в контейнере. */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function contentType(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function findFrontendDist(): string | undefined {
  return [
    path.resolve(process.cwd(), 'frontend/dist'),
    path.resolve(process.cwd(), '../frontend/dist'),
    path.resolve(process.cwd(), '../../frontend/dist'),
  ].find((candidate) => fs.existsSync(path.join(candidate, 'index.html')));
}

export async function buildServer(options: { serveFrontend?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.isTest ? false : {
      level: config.logLevel,
      /* Секреты не должны попадать в логи (§67 ТЗ). */
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]'],
    },
    trustProxy: true,
    bodyLimit: 12 * 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        mediaSrc: ["'self'", 'https:'],
        connectSrc: ["'self'"],
        /* Встраиваются только видео и трансляции с проверенных площадок. */
        frameSrc: ['https://www.youtube.com', 'https://www.youtube-nocookie.com',
                   'https://player.vimeo.com', 'https://zoom.us', 'https://*.zoom.us'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  if (config.corsOrigin) {
    await app.register(cors, {
      origin: config.corsOrigin.split(',').map((s) => s.trim()),
      credentials: true,
    });
  }

  await app.register(cookie, { secret: config.sessionSecret });
  /* global: false — при глобальном режиме плагин занимает обработчик 404,
     который конфликтует со Swagger UI. Ограничение применяется отдельным
     хуком: результат тот же, а обработчик 404 остаётся свободным.
     Защита от перебора паролей реализована отдельно, в auth/service.ts. */
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => fail('RATE_LIMITED', 'Слишком много запросов. Подождите немного.'),
  });
  app.addHook('onRequest', app.rateLimit({ max: 300, timeWindow: '1 minute' }));
  await app.register(multipart, { limits: { fileSize: MAX_FILE_BYTES, files: 1 } });

  if (!config.isProduction) {
    await app.register(swagger, {
      openapi: {
        info: { title: 'TBEDU LMS API', version: config.version,
                description: 'API корпоративной системы обучения' },
        tags: [
          { name: 'auth', description: 'Авторизация' },
          { name: 'training', description: 'Обучение' },
          { name: 'testing', description: 'Тестирование' },
          { name: 'system', description: 'Служебное' },
        ],
      },
    });
    await app.register(swaggerUi, { routePrefix: '/api/docs' });
  }

  await app.register(authPlugin);

  /* Единая обработка ошибок: наружу уходит понятное сообщение,
     подробности остаются в логе. */
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      const details = error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
      return reply.code(400).send(fail('VALIDATION_ERROR', 'Проверьте заполнение полей.', details));
    }
    if (error instanceof AppError) {
      return reply.code(error.status).send(fail(error.code, error.message, error.details));
    }
    if ((error as { statusCode?: number }).statusCode === 413) {
      return reply.code(413).send(fail('PAYLOAD_TOO_LARGE', 'Файл или запрос слишком большой.'));
    }

    const code = (error as { code?: string }).code;
    if (code === '23505') {
      return reply.code(409).send(fail('CONFLICT', 'Такая запись уже существует.'));
    }
    if (code === '23503') {
      return reply.code(409).send(fail('CONFLICT', 'Объект связан с другими записями и не может быть изменён.'));
    }

    request.log.error({ err: error, msg: redact((error as Error)?.message) }, 'Необработанная ошибка');
    return reply.code(500).send(fail('INTERNAL_ERROR', 'Внутренняя ошибка сервера. Попробуйте позже.'));
  });

  /* Один процесс отдаёт и API, и собранный фронтенд: так проще
     разворачивать — одна служба вместо двух.

     Используется обычный маршрут-перехватчик, а не setNotFoundHandler:
     обработчик 404 у Fastify может быть только один на префикс, и его
     занимают некоторые плагины. Перехватчик работает независимо от них. */
  const frontendDist = options.serveFrontend === false ? undefined : findFrontendDist();

  app.route({
    /* HEAD не указываем: Fastify создаёт его сам для каждого GET.
       OPTIONS не указываем: его занимает CORS для preflight-запросов.
       Явное объявление любого из них привело бы к конфликту маршрутов. */
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    url: '/*',
    handler: async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send(fail('NOT_FOUND', 'Такого метода API нет.'));
      }
      if (!frontendDist) {
        return reply.code(404).send(fail('NOT_FOUND', 'Страница не найдена.'));
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return reply.code(404).send(fail('NOT_FOUND', 'Страница не найдена.'));
      }

      /* Запрошенный путь приводим к абсолютному и проверяем, что он
         не вышел за пределы каталога сборки. */
      const relative = decodeURIComponent(request.url.split('?')[0]).replace(/^\/+/, '');
      const candidate = path.resolve(frontendDist, relative);

      if (
        relative &&
        candidate.startsWith(frontendDist) &&
        fs.existsSync(candidate) &&
        fs.statSync(candidate).isFile()
      ) {
        reply.header('content-type', contentType(candidate));
        /* Имена файлов сборки содержат хеш, поэтому кешируются надолго. */
        if (relative.startsWith('assets/')) {
          reply.header('cache-control', 'public, max-age=31536000, immutable');
        }
        return reply.send(fs.readFileSync(candidate));
      }

      /* Любой другой путь — маршрут внутри SPA, его разбирает браузер. */
      reply.header('content-type', 'text/html; charset=utf-8');
      reply.header('cache-control', 'no-cache');
      return reply.send(fs.readFileSync(path.join(frontendDist, 'index.html')));
    },
  });

  for (const route of [
    healthRoutes, authRoutes, orgRoutes, usersRoutes, employeesRoutes,
    trainingRoutes, assignmentsRoutes, testingRoutes, myRoutes,
    lecturesRoutes, certificatesRoutes, aiRoutes, filesRoutes,
    onecRoutes, uiRoutes, auditRoutes, adminRoutes,
  ]) {
    await app.register(route);
  }

  return app;
}
