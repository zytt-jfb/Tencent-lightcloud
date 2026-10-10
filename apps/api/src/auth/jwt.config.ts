import { ConfigService } from '@nestjs/config';

const JWT_SECRET_ERROR_PREFIX = '[AUTH_CONFIG] JWT_SECRET is required and must not be empty';
const DEFAULT_JWT_ISSUER = 'biz-reporting-api';
const DEFAULT_JWT_AUDIENCE = 'biz-reporting-clients';

// M8（DEV-064）：弱密钥检测——占位/默认/过短/常见弱词
const WEAK_SECRET_PATTERNS = [
  /^(secret|changeme|change-me|password|passwd|admin|administrator|123456|qwerty|letmein|your-secret|your_secret|xxx+)$/i,
  /^(test|demo|dev|local|default)[-_]?.*$/i,
];
function isWeakSecret(secret: string): boolean {
  if (secret.length < 32) return true; // 少于 32 字符视为弱
  if (WEAK_SECRET_PATTERNS.some((re) => re.test(secret))) return true;
  if (/^(.){7,}$/.test(secret)) return true; // 连续重复字符
  return false;
}

/** M8：校验密钥强度；生产环境弱密钥必须启动失败，开发环境告警。 */
export function assertSecretStrength(
  value: unknown,
  secretName: string,
  nodeEnv: unknown,
): void {
  const secret = typeof value === 'string' ? value.trim() : '';
  const isProduction = typeof nodeEnv === 'string' && nodeEnv.trim().toLowerCase() === 'production';
  if (isWeakSecret(secret)) {
    const message = `[SECURITY_CONFIG] ${secretName} 强度不足（长度<32 或为占位/默认/弱值），生产环境禁止启动`;
    if (isProduction) throw new Error(message);
    console.warn(`[SECURITY_CONFIG] ${secretName} 强度不足（仅开发环境告警）：${message}`);
  }
}

function normalizeJwtSecret(
  value: unknown,
  nodeEnv: unknown,
  deployEnv: unknown,
): string {
  const secret = typeof value === 'string' ? value.trim() : '';
  if (!secret) {
    const runtime = typeof nodeEnv === 'string' && nodeEnv.trim() ? nodeEnv.trim() : 'unspecified';
    const deployment = typeof deployEnv === 'string' && deployEnv.trim() ? deployEnv.trim() : 'unspecified';
    throw new Error(`${JWT_SECRET_ERROR_PREFIX} (NODE_ENV=${runtime}, DEPLOY_ENV=${deployment})`);
  }
  assertSecretStrength(secret, 'JWT_SECRET', nodeEnv);
  return secret;
}

/** 在 ConfigModule 初始化期间执行，确保任何模块连接外部资源前认证配置已通过。 */
export function validateAuthEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const jwtSecret = normalizeJwtSecret(config.JWT_SECRET, config.NODE_ENV, config.DEPLOY_ENV);
  // M8（DEV-064）：登录限流 HMAC 密钥同样做强度审计
  const authSecurityHmacKey = typeof config.AUTH_SECURITY_HMAC_KEY === 'string'
    ? config.AUTH_SECURITY_HMAC_KEY.trim()
    : '';
  if (!authSecurityHmacKey) throw new Error('[AUTH_CONFIG] AUTH_SECURITY_HMAC_KEY_REQUIRED');
  if (authSecurityHmacKey === jwtSecret) {
    throw new Error('[AUTH_CONFIG] AUTH_SECURITY_HMAC_KEY_MUST_DIFFER_FROM_JWT_SECRET');
  }
  assertSecretStrength(authSecurityHmacKey, 'AUTH_SECURITY_HMAC_KEY', config.NODE_ENV);
  return config;
}

/** JwtModule 与 JwtStrategy 共用同一个无回退密钥读取入口。 */
export function requireJwtSecret(config: ConfigService): string {
  return normalizeJwtSecret(
    config.get<unknown>('JWT_SECRET'),
    config.get<unknown>('NODE_ENV'),
    config.get<unknown>('DEPLOY_ENV'),
  );
}

/** 签发与验证共用同一 issuer（生产由 C-03 校验必填；非生产使用默认值保持本地可用）。 */
export function requireJwtIssuer(config: ConfigService): string {
  return config.get<string>('JWT_ISSUER')?.trim() || DEFAULT_JWT_ISSUER;
}

/** 签发与验证共用同一 audience（生产由 C-03 校验必填；非生产使用默认值保持本地可用）。 */
export function requireJwtAudience(config: ConfigService): string {
  return config.get<string>('JWT_AUDIENCE')?.trim() || DEFAULT_JWT_AUDIENCE;
}
