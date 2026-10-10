import { validateAuthEnvironment } from './auth/jwt.config';

const ERROR_PREFIX = '[RUNTIME_CONFIG]';

export function validateRuntimeEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  validateAuthEnvironment(config);
  if (normalize(config.NODE_ENV) !== 'production') return config;

  const deployEnv = normalize(config.DEPLOY_ENV);
  if (!['staging', 'production'].includes(deployEnv)) fail('DEPLOY_ENV_INVALID');
  if (normalize(config.DB_TYPE) !== 'mysql') fail('DB_TYPE_MYSQL_REQUIRED');

  const host = required(config.DB_HOST, 'DB_HOST_REQUIRED');
  if (isLocalOrUnspecifiedHost(host)) fail('DB_HOST_LOCAL_FORBIDDEN');
  validatePort(config.DB_PORT);

  const username = required(config.DB_USERNAME, 'DB_USERNAME_REQUIRED');
  if (username.toLowerCase() === 'root') fail('DB_ROOT_USER_FORBIDDEN');
  required(config.DB_PASSWORD, 'DB_PASSWORD_REQUIRED');
  required(config.DB_DATABASE, 'DB_DATABASE_REQUIRED');
  validateOptionalInteger(config.DB_POOL_CONNECTION_LIMIT, 'DB_POOL_CONNECTION_LIMIT_INVALID', 1, 50);
  validateOptionalInteger(config.DB_POOL_QUEUE_LIMIT, 'DB_POOL_QUEUE_LIMIT_INVALID', 0, 10000);

  if (normalize(config.DB_SYNC) !== 'false') fail('DB_SYNC_MUST_BE_FALSE');
  const factSourceStorageRoot = normalize(config.FACT_SOURCE_STORAGE_ROOT);
  if (factSourceStorageRoot && !factSourceStorageRoot.startsWith('/')) {
    fail('FACT_SOURCE_STORAGE_ROOT_MUST_BE_ABSOLUTE');
  }

  const origins = required(config.CORS_ORIGINS, 'CORS_ORIGINS_REQUIRED')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!origins.length || new Set(origins).size !== origins.length) fail('CORS_ORIGINS_INVALID');
  for (const origin of origins) validateOrigin(origin);

  // 可信代理：生产必须显式配置，只接受 1-3 的整数
  const trustProxyHops = required(config.TRUST_PROXY_HOPS, 'TRUST_PROXY_HOPS_REQUIRED');
  if (!/^[123]$/.test(trustProxyHops)) fail('TRUST_PROXY_HOPS_INVALID');

  // JWT issuer/audience：签发与验证共用，禁止留空
  required(config.JWT_ISSUER, 'JWT_ISSUER_REQUIRED');
  required(config.JWT_AUDIENCE, 'JWT_AUDIENCE_REQUIRED');

  // 登录安全密钥：独立于 JWT_SECRET，禁止相同
  requiredDistinctSecret(config, 'AUTH_SECURITY_HMAC_KEY', 'JWT_SECRET');

  // 登录限流与账号锁定窗口
  requiredInteger(config.AUTH_RATE_LIMIT_WINDOW_MS, 'AUTH_RATE_LIMIT_WINDOW_MS_REQUIRED', 'AUTH_RATE_LIMIT_WINDOW_MS_INVALID', 1, 86_400_000);
  requiredInteger(config.AUTH_RATE_LIMIT_IP_MAX, 'AUTH_RATE_LIMIT_IP_MAX_REQUIRED', 'AUTH_RATE_LIMIT_IP_MAX_INVALID', 1, 1_000_000);
  requiredInteger(config.AUTH_ACCOUNT_WINDOW_MS, 'AUTH_ACCOUNT_WINDOW_MS_REQUIRED', 'AUTH_ACCOUNT_WINDOW_MS_INVALID', 1, 86_400_000);
  requiredInteger(config.AUTH_ACCOUNT_MAX_FAILURES, 'AUTH_ACCOUNT_MAX_FAILURES_REQUIRED', 'AUTH_ACCOUNT_MAX_FAILURES_INVALID', 1, 1000);
  requiredInteger(config.AUTH_ACCOUNT_BLOCK_MS, 'AUTH_ACCOUNT_BLOCK_MS_REQUIRED', 'AUTH_ACCOUNT_BLOCK_MS_INVALID', 1, 86_400_000);

  // readiness 探针：缓存与超时窗口
  requiredInteger(config.READINESS_CACHE_MS, 'READINESS_CACHE_MS_REQUIRED', 'READINESS_CACHE_MS_INVALID', 1, 3_600_000);
  requiredInteger(config.READINESS_TIMEOUT_MS, 'READINESS_TIMEOUT_MS_REQUIRED', 'READINESS_TIMEOUT_MS_INVALID', 1, 60_000);

  return config;
}

export function parseCorsOrigins(value: unknown): string[] {
  return normalize(value)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function validatePort(value: unknown): void {
  const normalized = required(value, 'DB_PORT_INVALID');
  if (!/^[1-9]\d{0,4}$/.test(normalized) || Number(normalized) > 65535) fail('DB_PORT_INVALID');
}

function validateOptionalInteger(
  value: unknown,
  code: string,
  minimum: number,
  maximum: number,
): void {
  if (value === undefined || value === null || normalize(value) === '') return;
  const normalized = normalize(value);
  if (!/^\d+$/.test(normalized)) fail(code);
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(code);
}

function requiredInteger(
  value: unknown,
  requiredCode: string,
  invalidCode: string,
  minimum: number,
  maximum: number,
): number {
  const normalized = normalize(value);
  if (!normalized) fail(requiredCode);
  if (!/^\d+$/.test(normalized)) fail(invalidCode);
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(invalidCode);
  return parsed;
}

function requiredDistinctSecret(
  config: Record<string, unknown>,
  secretKey: string,
  otherKey: string,
): void {
  const secret = normalize(config[secretKey]);
  if (!secret) fail(`${secretKey}_REQUIRED`);
  const other = normalize(config[otherKey]);
  if (secret === other) fail(`${secretKey}_MUST_DIFFER_FROM_${otherKey}`);
}

function validateOrigin(origin: string): void {
  if (origin === '*') fail('CORS_WILDCARD_FORBIDDEN');
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    fail('CORS_ORIGIN_INVALID');
  }
  if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.username || parsed.password) {
    fail('CORS_ORIGIN_HTTPS_REQUIRED');
  }
  if (isLocalOrUnspecifiedHost(parsed.hostname)) fail('CORS_ORIGIN_LOCAL_FORBIDDEN');
}

function isLocalOrUnspecifiedHost(value: string): boolean {
  const host = value.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return host === 'localhost'
    || host.startsWith('localhost.')
    || host === '::1'
    || host === '::'
    || host === '0.0.0.0'
    || host.startsWith('127.')
    || host.startsWith('::ffff:127.');
}

function required(value: unknown, code: string): string {
  const normalized = normalize(value);
  if (!normalized) fail(code);
  return normalized;
}

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function fail(code: string): never {
  throw new Error(`${ERROR_PREFIX} ${code}`);
}
