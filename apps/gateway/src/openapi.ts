/**
 * OpenAPI 3.1 document for this gateway — the format Bazantic's "Deploy an
 * agent gateway" flow asks for (either a hosted URL or pasted JSON) to turn
 * these routes into agent-callable tools. `servers` is derived from the
 * incoming request so this is correct behind any hostname (a tunnel today, a
 * real domain later) with no hardcoded URL to keep in sync.
 */
export function buildOpenApiDocument(baseUrl: string, x402PriceUsdc: number) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Float sweep-decision gateway',
      version: '1.0.0',
      description:
        "Metered access to Float's \"should this ENS-named business sweep idle USDC into or out of its tokenized-Treasury position, and how much\" logic. Float is a non-custodial treasury wallet for agent-paid businesses.",
    },
    servers: [{ url: baseUrl }],
    paths: {
      '/v1/check': {
        post: {
          operationId: 'checkSweep',
          summary: 'Decide whether a business should sweep, and how much',
          description:
            'Omit requestedAction to get Float’s own recommendation (via the same decision engine the agent runs on); pass requestedAction + amount to validate a specific proposed sweep against the buffer, upcoming obligations, and the per-transaction cap.',
          'x-payment': {
            protocol: 'x402',
            network: 'base-sepolia',
            amount: `${x402PriceUsdc} USDC`,
          },
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['ensName'],
                  properties: {
                    ensName: {
                      type: 'string',
                      description: "The business's ENS name.",
                      examples: ['rosa-design.float.eth'],
                    },
                    requestedAction: { type: 'string', enum: ['sweep_in', 'sweep_out'] },
                    amount: { type: 'string', description: 'USDC, decimal string.' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Sweep decision',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ensName: { type: 'string' },
                      smartAccount: { type: 'string' },
                      allowed: { type: 'boolean' },
                      action: { type: 'string', enum: ['sweep_in', 'sweep_out', 'none'] },
                      recommendedAmount: { type: 'string', description: 'USDC, decimal string.' },
                      reason: { type: 'string' },
                      compliance: {
                        type: 'object',
                        properties: {
                          kycStatus: { type: 'string' },
                          verified: { type: 'boolean' },
                        },
                      },
                      policy: {
                        type: 'object',
                        properties: {
                          bufferAmount: { type: 'string' },
                          maxSweepPerTx: { type: 'string' },
                          allowedProtocol: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
            '400': { description: 'Invalid request' },
            '404': { description: 'Unknown ENS name' },
            '422': { description: 'Not allowed to sweep (e.g. not KYC-verified)' },
          },
        },
      },
      '/v1/policy/{ensName}': {
        get: {
          operationId: 'getPolicy',
          summary: "Free read-only view of a business's policy + compliance state",
          parameters: [
            {
              name: 'ensName',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              examples: { rosa: { value: 'rosa-design.float.eth' } },
            },
          ],
          responses: {
            '200': {
              description: 'Policy + compliance summary',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ensName: { type: 'string' },
                      smartAccount: { type: 'string' },
                      compliance: {
                        type: 'object',
                        properties: {
                          kycStatus: { type: 'string' },
                          verified: { type: 'boolean' },
                          verifiedAt: { type: 'string' },
                          accreditation: { type: 'string' },
                        },
                      },
                      policy: {
                        type: 'object',
                        properties: {
                          bufferAmount: { type: 'string' },
                          maxSweepPerTx: { type: 'string' },
                          allowedProtocol: { type: 'string' },
                          targetYieldToken: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
            '400': { description: 'Missing ensName' },
            '404': { description: 'Unknown ENS name' },
          },
        },
      },
    },
  } as const;
}
