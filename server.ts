import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './server/config/env';
import { seedDatabaseIfEmpty } from './server/db/database';
import { errorHandler } from './server/middleware/auth';
import { authRouter } from './server/routes/authRoutes';
import { directoryRouter } from './server/routes/directoryRoutes';
import { appointmentRouter } from './server/routes/appointmentRoutes';
import { recordsRouter } from './server/routes/recordsRoutes';
import { adminAndDashboardRouter } from './server/routes/adminAndDashboardRoutes';
import { startReminderWorker } from './server/jobs/reminderWorker';

async function bootstrap() {
  seedDatabaseIfEmpty();
  startReminderWorker();

  const app = express();
  app.set('trust proxy', 1);

  // Secure HTTP headers (relaxed CSP only to permit Vite / Google Fonts / Firebase popup in AI Studio)
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
    }),
  );

  // API rate limiting
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a moment and try again.' },
  });
  app.use('/api', apiLimiter);

  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'MediCloud API',
      timezone: env.tz,
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api', directoryRouter);
  app.use('/api/appointments', appointmentRouter);
  app.use('/api', recordsRouter);
  app.use('/api', adminAndDashboardRouter);

  app.use(errorHandler);

  if (env.nodeEnv !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build artifacts not found.');
      }
    });
  }

  app.listen(env.port, '0.0.0.0', () => {
    console.log(`[MediCloud] Server listening on http://0.0.0.0:${env.port} (${env.tz})`);
  });
}

bootstrap().catch((err) => {
  console.error('[MediCloud] Fatal startup error:', err);
  process.exit(1);
});
