import { formatUnits } from 'viem';
import { Hono } from 'hono';
import { recordGatewayCall } from './accounting.js';
import {
  CheckError,
  readPolicySummary,
  runCheck,
  type CheckDeps,
  type CheckRequest,
} from './check.js';
import { logger } from './logger.js';
import { buildOpenApiDocument } from './openapi.js';
import { rateLimit } from './rate-limit.js';
import type { GatewayRuntime } from './runtime.js';
import { priceToAtomic, x402Payment, type X402Outcome } from './x402.js';

type Env = { Variables: { x402: X402Outcome } };

export function createApp(rt: GatewayRuntime): Hono<Env> {
  const app = new Hono<Env>();
  const freeLimiter = rateLimit({
    windowMs: 60_000,
    max: rt.rateLimitPerMinute,
    keyPrefix: 'free',
  });
  const checkLimiter = rateLimit({
    // paid calls are already throttled economically by x402; this only caps
    // pre-payment challenge / invalid-payment spam.
    windowMs: 60_000,
    max: rt.rateLimitPerMinute * 5,
    keyPrefix: 'check',
  });
  const deps: CheckDeps = {
    publicClient: rt.publicClient,
    db: rt.db,
    deployment: rt.deployment,
    ensDeployment: rt.ensDeployment,
    maxComplianceAgeMs: rt.maxComplianceAgeMs,
    lookaheadMs: rt.env.SWEEP_OUT_LOOKAHEAD_HOURS * 3600_000,
  };

  app.get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }));

  app.get('/', (c) =>
    c.json({
      name: 'Float sweep-decision gateway',
      description: 'Metered access to Float’s "should this business sweep, and how much" logic.',
      x402: {
        enabled: rt.x402.enabled,
        network: rt.x402.network,
        price: `${rt.x402.priceUsdc} USDC`,
        priceAtomic: priceToAtomic(rt.x402.priceUsdc),
        payTo: rt.x402.payTo ?? null,
        asset: rt.x402.asset,
      },
      endpoints: {
        'POST /v1/check': 'metered — { ensName, requestedAction?, amount? } -> sweep decision',
        'GET /v1/policy/:ensName': 'free — policy + compliance summary',
      },
    }),
  );

  // Bazantic's gateway-import flow reads this to turn /v1/check and
  // /v1/policy into agent-callable tools — see docs/bazantic-setup.md.
  app.get('/openapi.json', (c) => {
    const base = new URL(c.req.url).origin;
    return c.json(buildOpenApiDocument(base, rt.x402.priceUsdc));
  });

  app.get('/v1/policy/:ensName', freeLimiter, async (c) => {
    try {
      return c.json(await readPolicySummary(deps, c.req.param('ensName')));
    } catch (err) {
      if (err instanceof CheckError) return c.json({ error: err.message }, err.status);
      logger.error({ err }, 'policy summary failed');
      return c.json({ error: 'internal error' }, 500);
    }
  });

  app.post(
    '/v1/check',
    checkLimiter,
    x402Payment(rt.x402, { description: 'Float sweep-decision check' }),
    async (c) => {
      const started = Date.now();
      const pay = c.get('x402');

      let body: CheckRequest;
      try {
        body = await c.req.json<CheckRequest>();
      } catch {
        return c.json({ error: 'invalid JSON body' }, 400);
      }

      let status = 200;
      let payload: unknown;
      let allowed: boolean | null = null;
      try {
        const result = await runCheck(deps, body);
        payload = result;
        allowed = result.allowed;
      } catch (err) {
        if (err instanceof CheckError) {
          status = err.status;
          payload = { error: err.message };
        } else {
          logger.error({ err }, 'check failed');
          status = 500;
          payload = { error: 'internal error' };
        }
      }

      await recordGatewayCall(rt.db, {
        callerAddress: pay.payer ?? null,
        endpoint: '/v1/check',
        ensName: body.ensName ?? null,
        request: body as unknown as Record<string, unknown>,
        responseSummary:
          status === 200 && payload && typeof payload === 'object'
            ? {
                allowed: (payload as { allowed: boolean }).allowed,
                action: (payload as { action: string }).action,
                recommendedAmount: (payload as { recommendedAmount: string }).recommendedAmount,
              }
            : (payload as Record<string, unknown>),
        allowed,
        paidAmount: pay.paid && rt.x402.enabled ? formatUnits(BigInt(pay.amountAtomic), 6) : null,
        x402TxHash: pay.settleTxHash ?? null,
        statusCode: status,
        latencyMs: Date.now() - started,
      });

      return c.json(payload as Record<string, unknown>, status as 200 | 400 | 404 | 422 | 500);
    },
  );

  return app;
}
