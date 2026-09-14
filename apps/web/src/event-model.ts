import type { RealtimeEvent } from '@tiktok-helper/contracts';

export function operatorEventCount(events: RealtimeEvent[]): number {
  return events.filter((event) => event.type !== 'connection.state').length;
}
