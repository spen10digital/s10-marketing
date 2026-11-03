import type { AppConfig } from '../config/params';
import { AppError } from '../errors/app-error';
import { priceFor } from './pricing';
import type { ModelTier } from './types';

/** ModelRouter (02 §5): task tier → model ID from Parameter Store. */
export interface ModelRouter {
  modelFor(tier: ModelTier): string;
}

export function routerFromConfig(
  config: Pick<AppConfig, 'AI_MODEL_GENERATE' | 'AI_MODEL_FAST'>,
): ModelRouter {
  const models: Record<ModelTier, string | undefined> = {
    generate: config.AI_MODEL_GENERATE,
    fast: config.AI_MODEL_FAST,
  };
  return {
    modelFor(tier) {
      const id = models[tier];
      if (!id) throw new AppError('CONFIG_INVALID', 'AI is not configured for this environment.');
      priceFor(id); // refuses models without a price
      return id;
    },
  };
}
