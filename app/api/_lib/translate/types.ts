/**
 * Machine-translation provider abstraction.
 *
 * Stage-1 full-text translation is a high-frequency, low-creativity job —
 * it must NOT go through resolveClient / BYOK LLM providers. Swap the
 * active provider in `index.ts` when you need to change vendors
 * (Baidu → Volcengine / Niutrans / …).
 */

export interface TranslateRequest {
  text: string;
  /** Source language code understood by the provider (e.g. "spa", "auto"). */
  from: string;
  /** Target language code (e.g. "zh"). */
  to: string;
}

export interface TranslateResult {
  translation: string;
}

export interface TranslateProvider {
  readonly name: string;
  translate(req: TranslateRequest): Promise<TranslateResult>;
}

export class TranslateConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslateConfigError";
  }
}

export class TranslateRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslateRequestError";
  }
}
