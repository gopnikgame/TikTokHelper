import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import type { Database } from '../db/client.js';
import { appSessions, users, workspaceMemberships, workspaces } from '../db/schema.js';

export type AppUser = typeof users.$inferSelect;
export type WorkspaceMembership = typeof workspaceMemberships.$inferSelect;
export type AppSession = typeof appSessions.$inferSelect;

export interface ExternalIdentityInput {
  provider: string;
  subject: string;
  displayName?: string | null;
  authenticatedAt: Date;
}

export interface NewSessionInput {
  userId: string;
  tokenHash: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface ActiveSession {
  session: AppSession;
  user: AppUser;
}

export interface AuthRepository {
  upsertIdentity(input: ExternalIdentityInput): Promise<AppUser>;
  createWorkspaceForUser(userId: string, displayName: string): Promise<WorkspaceMembership>;
  assignMembership(userId: string, workspaceId: string, role: 'owner' | 'member'): Promise<WorkspaceMembership>;
  hasWorkspaceAccess(userId: string, workspaceId: string): Promise<boolean>;
  listWorkspaceIds(userId: string): Promise<string[]>;
  issueSession(input: NewSessionInput): Promise<AppSession>;
  findActiveSession(tokenHash: string, now: Date): Promise<ActiveSession | null>;
  touchSession(sessionId: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void>;
  revokeSession(sessionId: string, userId: string, revokedAt: Date): Promise<boolean>;
  deleteExpiredSessions(now: Date): Promise<number>;
}

export function createAuthRepository(db: Database): AuthRepository {
  return {
    async upsertIdentity(input) {
      const [user] = await db.insert(users).values({
        identityProvider: input.provider,
        identitySubject: input.subject,
        displayName: input.displayName ?? null,
        lastLoginAt: input.authenticatedAt,
      }).onConflictDoUpdate({
        target: [users.identityProvider, users.identitySubject],
        set: {
          displayName: input.displayName ?? null,
          lastLoginAt: input.authenticatedAt,
          updatedAt: input.authenticatedAt,
        },
      }).returning();
      if (!user) throw new Error('Identity upsert did not return a user');
      return user;
    },

    async createWorkspaceForUser(userId, displayName) {
      return db.transaction(async (tx) => {
        const workspaceId = randomUUID();
        await tx.insert(workspaces).values({ id: workspaceId, displayName });
        const [membership] = await tx.insert(workspaceMemberships).values({
          workspaceId, userId, role: 'owner',
        }).returning();
        if (!membership) throw new Error('Workspace creation did not return a membership');
        return membership;
      });
    },

    async assignMembership(userId, workspaceId, role) {
      const [membership] = await db.insert(workspaceMemberships).values({
        workspaceId, userId, role,
      }).onConflictDoUpdate({
        target: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
        set: { role },
      }).returning();
      if (!membership) throw new Error('Membership assignment did not return a row');
      return membership;
    },

    async hasWorkspaceAccess(userId, workspaceId) {
      const [membership] = await db.select({ userId: workspaceMemberships.userId })
        .from(workspaceMemberships)
        .innerJoin(users, eq(users.id, workspaceMemberships.userId))
        .where(and(
          eq(workspaceMemberships.userId, userId),
          eq(workspaceMemberships.workspaceId, workspaceId),
          eq(users.status, 'active'),
        )).limit(1);
      return membership !== undefined;
    },

    async listWorkspaceIds(userId) {
      const rows = await db.select({ workspaceId: workspaceMemberships.workspaceId })
        .from(workspaceMemberships)
        .innerJoin(users, eq(users.id, workspaceMemberships.userId))
        .where(and(eq(workspaceMemberships.userId, userId), eq(users.status, 'active')));
      return rows.map((row) => row.workspaceId);
    },

    async issueSession(input) {
      const [session] = await db.insert(appSessions).values(input).returning();
      if (!session) throw new Error('Session creation did not return a row');
      return session;
    },

    async findActiveSession(tokenHash, now) {
      const [result] = await db.select({ session: appSessions, user: users })
        .from(appSessions)
        .innerJoin(users, eq(users.id, appSessions.userId))
        .where(and(
          eq(appSessions.tokenHash, tokenHash),
          isNull(appSessions.revokedAt),
          gt(appSessions.idleExpiresAt, now),
          gt(appSessions.absoluteExpiresAt, now),
          eq(users.status, 'active'),
        )).limit(1);
      return result ?? null;
    },

    async touchSession(sessionId, lastSeenAt, idleExpiresAt) {
      await db.update(appSessions).set({ lastSeenAt, idleExpiresAt })
        .where(and(
          eq(appSessions.id, sessionId),
          isNull(appSessions.revokedAt),
          gt(appSessions.absoluteExpiresAt, idleExpiresAt),
        ));
    },

    async revokeSession(sessionId, userId, revokedAt) {
      const rows = await db.update(appSessions).set({ revokedAt })
        .where(and(
          eq(appSessions.id, sessionId),
          eq(appSessions.userId, userId),
          isNull(appSessions.revokedAt),
        )).returning({ id: appSessions.id });
      return rows.length === 1;
    },

    async deleteExpiredSessions(now) {
      const rows = await db.delete(appSessions).where(or(
        lt(appSessions.idleExpiresAt, now),
        lt(appSessions.absoluteExpiresAt, now),
        sql`${appSessions.revokedAt} is not null and ${appSessions.revokedAt} < ${now}`,
      )).returning({ id: appSessions.id });
      return rows.length;
    },
  };
}
