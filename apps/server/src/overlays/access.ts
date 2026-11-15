import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isGiftGoalOverlayToken, type StreamOverlayKind } from '@tiktok-helper/contracts';

const LINK_ID_BYTES = 16;
const SIGNING_KEY_BYTES = 32;

export class OverlayAccess {
  readonly #signingKey = randomBytes(SIGNING_KEY_BYTES);
  readonly #linkIdsByWorkspace = new Map<string, string>();
  readonly #workspaceIdsByLink = new Map<string, string>();

  constructor(private readonly kind: StreamOverlayKind) {}

  tokenFor(workspaceId: string): string | null {
    const linkId = this.#linkIdsByWorkspace.get(workspaceId);
    return linkId === undefined ? null : this.#tokenForLink(linkId);
  }

  setEnabled(workspaceId: string, enabled: boolean): string | null {
    const existing = this.#linkIdsByWorkspace.get(workspaceId);
    if (!enabled) {
      if (existing !== undefined) {
        this.#linkIdsByWorkspace.delete(workspaceId);
        this.#workspaceIdsByLink.delete(existing);
      }
      return null;
    }
    if (existing !== undefined) return this.#tokenForLink(existing);

    let linkId: string;
    do { linkId = randomBytes(LINK_ID_BYTES).toString('base64url'); }
    while (this.#workspaceIdsByLink.has(linkId));
    this.#linkIdsByWorkspace.set(workspaceId, linkId);
    this.#workspaceIdsByLink.set(linkId, workspaceId);
    return this.#tokenForLink(linkId);
  }

  resolve(token: unknown): string | null {
    if (!isGiftGoalOverlayToken(token)) return null;
    const separator = token.indexOf('.');
    const linkId = token.slice(0, separator);
    const workspaceId = this.#workspaceIdsByLink.get(linkId);
    if (workspaceId === undefined) return null;

    // Compare canonical encodings so alternate spellings of the same bytes are rejected.
    const suppliedSignature = Buffer.from(token.slice(separator + 1), 'ascii');
    const expectedSignature = Buffer.from(this.#sign(linkId), 'ascii');
    return timingSafeEqual(suppliedSignature, expectedSignature) ? workspaceId : null;
  }

  #sign(linkId: string): string {
    return createHmac('sha256', this.#signingKey).update(this.kind + ':' + linkId, 'ascii').digest('base64url');
  }

  #tokenForLink(linkId: string): string {
    return `${linkId}.${this.#sign(linkId)}`;
  }
}
