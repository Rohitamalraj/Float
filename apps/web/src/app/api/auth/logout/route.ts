import { clearSession } from '@/lib/session';
import { handler, ok } from '@/lib/api';

export const POST = handler(async () => {
  await clearSession();
  return ok({ ok: true });
});
