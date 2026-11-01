import { createLogger, type Logger } from '@s10/core';

/**
 * Lambda handlers stay thin and call packages/core (05 §3). Handlers arrive with their
 * milestones: cognito-post-confirmation (M1.2), publish-worker (M1.5), sweeper (M2.1), …
 */
export function handlerLogger(handler: string, requestId?: string): Logger {
  return createLogger({ level: process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info' }).child({
    handler,
    requestId,
  });
}
