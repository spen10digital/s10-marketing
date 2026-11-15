import { z } from 'zod';

/** The voice editor's fields. Zod only, so browser code can import it. */
const list = (maxItems: number, maxLength: number) =>
  z
    .array(z.string().trim().max(maxLength))
    .max(maxItems)
    .transform((items) => items.filter((v) => v !== ''));

export const brandVoiceInput = z.object({
  audience: z.string().trim().max(1000),
  tone: z.string().trim().max(500),
  guidelines: z.string().trim().max(4000),
  doList: list(20, 300),
  dontList: list(20, 300),
  examplePosts: list(10, 2000),
  ctaDefaults: list(10, 300),
});
export type BrandVoiceInput = z.input<typeof brandVoiceInput>;
