import type { User, Authenticator } from '@prisma/client';
import type { VerifiedRegistrationResponse } from '@simplewebauthn/server';
import type {
  AuthenticatorTransportFuture,
  AuthenticatorDevice,
} from '@simplewebauthn/typescript-types';
import { randomUUID } from 'crypto';
import { z } from 'zod';

import { prisma } from '~/db.server';

export type { AuthenticatorDevice };

type RegistrationInfo = NonNullable<
  VerifiedRegistrationResponse['registrationInfo']
>;

export const WebAuthnUser = z.object({
  userID: z.string().uuid(),
  userName: z.string().email(),
});
export type WebAuthnUser = z.infer<typeof WebAuthnUser>;

export async function getUserById(
  id: User['id']
): Promise<WebAuthnUser | null> {
  return prisma.user
    .findUnique({ where: { id }, select: { id: true, email: true } })
    .then(serializeUserOrNull);
}

export async function getUserByEmail(
  email: User['email']
): Promise<WebAuthnUser | null> {
  return prisma.user
    .findUnique({ where: { email }, select: { id: true, email: true } })
    .then(serializeUserOrNull);
}

export function newUser(email: string): WebAuthnUser {
  return { userID: randomUUID(), userName: email };
}

export async function createOrUpdateUser({
  user,
  registrationInfo: {
    credentialID,
    credentialDeviceType,
    credentialPublicKey,
    credentialBackedUp,
    counter,
  },
  transports = [],
  userAgent,
}: {
  user: WebAuthnUser;
  registrationInfo: RegistrationInfo;
  transports?: AuthenticatorTransportFuture[];
  userAgent?: string;
}): Promise<WebAuthnUser> {
  return prisma.user
    .upsert({
      where: { id: user.userID },
      create: {
        id: user.userID,
        email: user.userName,
        authenticators: {
          create: {
            credentialID: Buffer.from(credentialID).toString('base64url'),
            credentialDeviceType,
            credentialPublicKey: Buffer.from(credentialPublicKey),
            credentialBackedUp,
            counter,
            transports,
            userAgent,
          },
        },
      },
      update: {
        authenticators: {
          create: {
            credentialID: Buffer.from(credentialID).toString('base64url'),
            credentialDeviceType,
            credentialPublicKey: Buffer.from(credentialPublicKey),
            credentialBackedUp,
            counter,
            transports,
            userAgent,
          },
        },
      },
      select: { id: true, email: true },
    })
    .then(serializeUser);
}

export async function getAuthenticatorById(
  email: string,
  credentialID: string
): Promise<AuthenticatorDevice | null> {
  const authenticator = await prisma.authenticator.findFirst({
    where: { user: { email }, credentialID },
  });
  if (authenticator) {
    return serializeAuthenticator(authenticator);
  }
  return null;
}

export async function getAuthenticatorsByEmail(
  email: string
): Promise<AuthenticatorDevice[]> {
  const authenticators = await prisma.authenticator.findMany({
    where: { user: { email } },
  });
  return authenticators.map(serializeAuthenticator);
}

export function updateUserAuthenticatorCounter({
  userID,
  credentialID,
  counter,
}: {
  userID: string;
  credentialID: string;
  counter: number;
}) {
  return prisma.authenticator.update({
    where: { userId_credentialID: { userId: userID, credentialID } },
    data: { counter },
  });
}

export async function deleteUserByEmail(email: User['email']) {
  return prisma.user.delete({ where: { email } });
}

export async function deleteAuthenticatorById({
  userID,
  credentialID,
}: {
  userID: string;
  credentialID: string;
}) {
  return prisma.authenticator.delete({
    where: { userId_credentialID: { userId: userID, credentialID } },
  });
}

function serializeUser(user: Pick<User, 'id' | 'email'>): WebAuthnUser {
  return { userID: user.id, userName: user.email };
}

function serializeUserOrNull(
  user: Pick<User, 'id' | 'email'> | null
): WebAuthnUser | null {
  return user ? serializeUser(user) : null;
}

function serializeAuthenticator(
  authenticator: Pick<
    Authenticator,
    'credentialID' | 'credentialPublicKey' | 'counter' | 'transports'
  >
): AuthenticatorDevice {
  return {
    ...authenticator,
    credentialID: Buffer.from(authenticator.credentialID, 'base64url'),
    transports: authenticator.transports as AuthenticatorTransportFuture[],
  };
}
