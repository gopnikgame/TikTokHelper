export const APPLICATION_BASE = import.meta.env.BASE_URL;
export const USES_CABINET = APPLICATION_BASE === '/tiktokhelper/';

export function appPath(relativePath: string): string {
  return `${APPLICATION_BASE}${relativePath}`;
}
