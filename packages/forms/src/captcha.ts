/**
 * @flowmonkey/forms - CAPTCHA Verification
 *
 * Support for reCAPTCHA v2/v3, hCaptcha, Turnstile, and custom providers.
 */

import type { CaptchaConfig, CaptchaResult } from './types';

/**
 * CAPTCHA verification provider interface.
 */
export interface CaptchaProvider {
  /** Verify a CAPTCHA token */
  verify(token: string, ip?: string): Promise<CaptchaResult>;
}

/**
 * reCAPTCHA v2 verification provider.
 */
export class RecaptchaV2Provider implements CaptchaProvider {
  constructor(private readonly secretKey: string) {}

  async verify(token: string, ip?: string): Promise<CaptchaResult> {
    const params = new URLSearchParams({
      secret: this.secretKey,
      response: token,
    });
    if (ip) params.append('remoteip', ip);

    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = await response.json() as {
      success: boolean;
      'error-codes'?: string[];
    };

    return {
      success: data.success,
      errorCodes: data['error-codes'],
    };
  }
}

/**
 * reCAPTCHA v3 verification provider (with score).
 */
export class RecaptchaV3Provider implements CaptchaProvider {
  constructor(
    private readonly secretKey: string,
    private readonly minScore = 0.5
  ) {}

  async verify(token: string, ip?: string): Promise<CaptchaResult> {
    const params = new URLSearchParams({
      secret: this.secretKey,
      response: token,
    });
    if (ip) params.append('remoteip', ip);

    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = await response.json() as {
      success: boolean;
      score?: number;
      'error-codes'?: string[];
    };

    return {
      success: data.success && (data.score ?? 0) >= this.minScore,
      score: data.score,
      errorCodes: data['error-codes'],
    };
  }
}

/**
 * hCaptcha verification provider.
 */
export class HCaptchaProvider implements CaptchaProvider {
  constructor(private readonly secretKey: string) {}

  async verify(token: string, ip?: string): Promise<CaptchaResult> {
    const params = new URLSearchParams({
      secret: this.secretKey,
      response: token,
    });
    if (ip) params.append('remoteip', ip);

    const response = await fetch('https://hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = await response.json() as {
      success: boolean;
      'error-codes'?: string[];
    };

    return {
      success: data.success,
      errorCodes: data['error-codes'],
    };
  }
}

/**
 * Cloudflare Turnstile verification provider.
 */
export class TurnstileProvider implements CaptchaProvider {
  constructor(private readonly secretKey: string) {}

  async verify(token: string, ip?: string): Promise<CaptchaResult> {
    const body: Record<string, string> = {
      secret: this.secretKey,
      response: token,
    };
    if (ip) body.remoteip = ip;

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json() as {
      success: boolean;
      'error-codes'?: string[];
    };

    return {
      success: data.success,
      errorCodes: data['error-codes'],
    };
  }
}

/**
 * Custom CAPTCHA verification provider.
 */
export class CustomCaptchaProvider implements CaptchaProvider {
  constructor(
    private readonly verifyUrl: string,
    private readonly secretKey: string
  ) {}

  async verify(token: string, ip?: string): Promise<CaptchaResult> {
    const response = await fetch(this.verifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.secretKey}`,
      },
      body: JSON.stringify({ token, ip }),
    });

    const data = await response.json() as {
      success: boolean;
      score?: number;
      errorCodes?: string[];
    };

    return {
      success: data.success,
      score: data.score,
      errorCodes: data.errorCodes,
    };
  }
}

/**
 * Create CAPTCHA provider from configuration.
 */
export function createCaptchaProvider(config: CaptchaConfig): CaptchaProvider {
  switch (config.provider) {
    case 'recaptcha-v2':
      return new RecaptchaV2Provider(config.secretKey);
    case 'recaptcha-v3':
      return new RecaptchaV3Provider(config.secretKey, config.minScore);
    case 'hcaptcha':
      return new HCaptchaProvider(config.secretKey);
    case 'turnstile':
      return new TurnstileProvider(config.secretKey);
    case 'custom':
      if (!config.verifyUrl) {
        throw new Error('Custom CAPTCHA provider requires verifyUrl');
      }
      return new CustomCaptchaProvider(config.verifyUrl, config.secretKey);
    default:
      throw new Error(`Unknown CAPTCHA provider: ${config.provider}`);
  }
}

/**
 * Verify CAPTCHA token using configuration.
 */
export async function verifyCaptcha(
  config: CaptchaConfig,
  token: string,
  ip?: string
): Promise<CaptchaResult> {
  const provider = createCaptchaProvider(config);
  return provider.verify(token, ip);
}
