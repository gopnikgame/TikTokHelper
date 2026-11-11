import type { AuthConfiguration } from './service.js';

export type PublicBasePath = '/' | '/tiktokhelper/';
type BridgeCredentials = { clientId: string; clientSecret: string };

export type BridgeConfiguration = {
  auth: AuthConfiguration;
  tokenUrl: string;
  credentials: BridgeCredentials;
  entitlement?: { url: string; credentials: BridgeCredentials };
};

const cabinetBridgePath = '/api/integrations/tiktokhelper/';

export function readPublicBasePath(value: string | undefined): PublicBasePath {
  if (!value || value === '/') return '/';
  if (value === '/tiktokhelper/') return value;
  throw new Error('Invalid TIKTOK_HELPER_BASE_PATH');
}

function readUrl(value: string, httpsOnly: boolean): URL {
  const url = URL.parse(value);
  if (!url || (url.protocol !== 'https:' && (httpsOnly || url.protocol !== 'http:')) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid TikTokHelper bridge URL configuration');
  }
  return url;
}

function validClientCredentials(clientId: string, clientSecret: string): boolean {
  return /^[A-Za-z0-9._~-]{1,64}$/.test(clientId) && /^[A-Za-z0-9._~-]{32,256}$/.test(clientSecret);
}

export function readBridgeConfiguration(env: NodeJS.ProcessEnv, basePath: PublicBasePath): BridgeConfiguration | undefined {
  const { VLINE_BRIDGE_AUTHORIZE_URL: authorizeUrl, VLINE_BRIDGE_TOKEN_URL: tokenUrl,
    VLINE_BRIDGE_CLIENT_ID: clientId, VLINE_BRIDGE_CLIENT_SECRET: clientSecret,
    VLINE_BRIDGE_REDIRECT_URI: redirectUri, VLINE_BRIDGE_ENTITLEMENT_URL: entitlementUrl,
    VLINE_BRIDGE_ENTITLEMENT_CLIENT_ID: entitlementClientId,
    VLINE_BRIDGE_ENTITLEMENT_CLIENT_SECRET: entitlementClientSecret } = env;
  const integrated = basePath !== '/';
  if (!integrated && ![authorizeUrl, tokenUrl, clientId, clientSecret, redirectUri].some(Boolean)) return;
  if (!authorizeUrl || !tokenUrl || !clientId || !clientSecret || !redirectUri) {
    throw new Error('All VLINE_BRIDGE login variables are required when authentication is enabled');
  }
  const configuration: BridgeConfiguration = {
    auth: { basePath, bridgeAuthorizeUrl: authorizeUrl, clientId, redirectUri },
    tokenUrl, credentials: { clientId, clientSecret },
  };
  if (integrated) {
    const authorize = readUrl(authorizeUrl, true);
    const redirect = readUrl(redirectUri, true);
    const token = readUrl(tokenUrl, false);
    if (authorize.pathname !== `${cabinetBridgePath}authorize` ||
        redirectUri !== `${authorize.origin}${basePath}auth/callback` || redirect.origin !== authorize.origin ||
        token.pathname !== `${cabinetBridgePath}token` || !validClientCredentials(clientId, clientSecret)) {
      throw new Error('Invalid TikTokHelper cabinet bridge configuration');
    }
    if (!entitlementUrl || !entitlementClientId || !entitlementClientSecret) {
      throw new Error('All VLINE_BRIDGE_ENTITLEMENT variables are required in cabinet mode');
    }
    readUrl(entitlementUrl, false);
    configuration.entitlement = { url: entitlementUrl,
      credentials: { clientId: entitlementClientId, clientSecret: entitlementClientSecret } };
  }
  return configuration;
}
