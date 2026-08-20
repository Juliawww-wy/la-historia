import { BaiduTranslateProvider } from "./baidu";
import { TranslateProvider } from "./types";

/**
 * Active machine-translation provider.
 *
 * To switch vendors later (Volcengine / Niutrans / …), implement
 * TranslateProvider and return it here — the /api/translate route stays unchanged.
 */
export function getTranslateProvider(): TranslateProvider {
  return new BaiduTranslateProvider();
}

export {
  TranslateConfigError,
  TranslateRequestError,
  type TranslateProvider,
  type TranslateRequest,
  type TranslateResult,
} from "./types";
