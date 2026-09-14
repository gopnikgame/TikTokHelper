import type { HealthResponse } from '@tiktok-helper/contracts';

export function getHealthLabel(health: HealthResponse): string {
  return health.status === 'ok' ? 'Каркас приложения готов' : 'Недоступно';
}
