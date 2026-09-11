import { Hono } from 'hono';

const app = new Hono();

app.use('*', async (context, next) => {
  context.header('Cache-Control', 'no-store');
  context.header('X-Content-Type-Options', 'nosniff');
  await next();
});

app.get('/api/health', (context) => {
  return context.json({ status: 'ok', service: 'yzt-randevu' });
});

app.all('/api/health', (context) => {
  context.header('Allow', 'GET, HEAD');
  return context.json(
    {
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Bu adres için GET veya HEAD kullanın.',
      },
    },
    405,
  );
});

app.notFound((context) => {
  return context.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: 'İstenen API adresi bulunamadı.',
      },
    },
    404,
  );
});

app.onError((error, context) => {
  console.error('API request failed', { name: error.name });
  return context.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'İşlem tamamlanamadı. Lütfen tekrar deneyin.',
      },
    },
    500,
  );
});

export default app;
