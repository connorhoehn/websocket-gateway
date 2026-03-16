import { createApp } from './app';

const port = process.env.PORT ?? '3001';

if (!process.env.COGNITO_REGION || !process.env.COGNITO_USER_POOL_ID) {
  console.error('FATAL: COGNITO_REGION and COGNITO_USER_POOL_ID must be set');
  process.exit(1);
}

const app = createApp();
app.listen(Number(port), () => {
  console.log(`social-api listening on port ${port}`);
});
