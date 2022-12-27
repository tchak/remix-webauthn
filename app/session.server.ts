import {
  createCookieSessionStorage,
  redirect,
  json,
  type Session,
} from '@remix-run/node';
import invariant from 'tiny-invariant';
import * as SimpleWebAuthnServer from '@simplewebauthn/server';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationCredentialJSON,
  PublicKeyCredentialRequestOptionsJSON,
  AuthenticationCredentialJSON,
} from '@simplewebauthn/typescript-types';
import { z } from 'zod';
import { fromZodError } from 'zod-validation-error';

import { createOrUpdateUser, WebAuthnUser } from '~/models/user.server';
import {
  getUserById,
  getAuthenticatorById,
  getAuthenticatorsByEmail,
  updateUserAuthenticatorCounter,
} from '~/models/user.server';

invariant(process.env.SESSION_SECRET, 'SESSION_SECRET must be set');

export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: '__session',
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secrets: [process.env.SESSION_SECRET],
    secure: process.env.NODE_ENV == 'production',
  },
});

const USER_SESSION_KEY = 'userId';
const REGISTRATION_SESSION_KEY = 'registration';
const AUTHENTICATION_SESSION_KEY = 'authentication';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const WebAuthnRegistrationSession = z.object({
  user: WebAuthnUser,
  challenge: z.string(),
  redirectTo: z.string().default('/'),
});
const WebAuthnAuthenticationSession = z.object({
  user: WebAuthnUser.optional(),
  challenge: z.string(),
  redirectTo: z.string().default('/'),
});

export async function getSession(request: Request) {
  const cookie = request.headers.get('Cookie');
  return sessionStorage.getSession(cookie);
}

async function getUserId(
  request: Request
): Promise<WebAuthnUser['userID'] | undefined> {
  const session = await getSession(request);
  const userId = session.get(USER_SESSION_KEY);
  return userId;
}

async function requireUserId(
  request: Request,
  redirectTo: string = new URL(request.url).pathname
) {
  const userId = await getUserId(request);
  if (!userId) {
    const searchParams = new URLSearchParams([['redirectTo', redirectTo]]);
    throw redirect(`/login?${searchParams}`);
  }
  return userId;
}

export async function getUser(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return null;

  const user = await getUserById(userId);
  if (user) return user;

  throw await logout(request);
}

export async function requireUser(request: Request) {
  const userId = await requireUserId(request);

  const user = await getUserById(userId);
  if (user) return user;

  throw await logout(request);
}

export async function requireNoUser(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return null;

  const user = await getUserById(userId);
  if (!user) return null;

  throw redirect('/');
}

export async function logout(request: Request) {
  const session = await getSession(request);
  return redirect('/', {
    headers: {
      'set-cookie': await sessionStorage.destroySession(session),
    },
  });
}

export async function generateRegistrationOptions({
  request,
  user,
  redirectTo,
  rpName,
}: {
  request: Request;
  user: WebAuthnUser;
  redirectTo: string;
  rpName: string;
}) {
  const session = await getSession(request);
  const authenticators = await getAuthenticatorsByEmail(user.userName);
  const url = new URL(request.url);

  const options = SimpleWebAuthnServer.generateRegistrationOptions({
    rpID: url.hostname,
    rpName,
    ...user,
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'preferred',
    },
    excludeCredentials: authenticators.map(({ credentialID, transports }) => ({
      type: 'public-key',
      id: credentialID,
      transports,
    })),
  });

  return registrationResponse({
    session,
    options,
    user,
    redirectTo,
  });
}

export async function generateAuthenticationOptions({
  request,
  user,
  redirectTo,
}: {
  request: Request;
  user?: WebAuthnUser;
  redirectTo: string;
}) {
  const session = await getSession(request);
  const authenticators = user
    ? await getAuthenticatorsByEmail(user.userName)
    : [];
  const url = new URL(request.url);

  const options = SimpleWebAuthnServer.generateAuthenticationOptions({
    rpID: url.hostname,
    userVerification: 'preferred',
    allowCredentials: authenticators.map(({ credentialID, transports }) => ({
      type: 'public-key',
      id: credentialID,
      transports,
    })),
  });

  return authenticationResponse({
    session,
    options,
    user,
    redirectTo,
  });
}

export async function verifyRegistrationResponse({
  request,
  credential,
}: {
  request: Request;
  credential: RegistrationCredentialJSON;
}) {
  const session = await getSession(request);
  const result = WebAuthnRegistrationSession.safeParse(
    session.get(REGISTRATION_SESSION_KEY)
  );
  if (!result.success) {
    return json(
      { errors: { webauthn: fromZodError(result.error).message } },
      { status: 400 }
    );
  }
  const { user, challenge: expectedChallenge, redirectTo } = result.data;
  const url = new URL(request.url);

  const { verified, registrationInfo } =
    await SimpleWebAuthnServer.verifyRegistrationResponse({
      credential,
      expectedChallenge,
      expectedRPID: url.hostname,
      expectedOrigin: url.origin,
      requireUserVerification: true,
    });

  if (!verified || !registrationInfo) {
    return json(
      {
        errors: {
          webauthn: 'Registration verification failed',
        },
      },
      { status: 400 }
    );
  }

  await createOrUpdateUser({
    user,
    registrationInfo,
    transports: credential.transports,
    userAgent: request.headers.get('user-agent') ?? undefined,
  });

  return createUserSession({ session, user, redirectTo });
}

export async function verifyAuthenticationResponse({
  request,
  credential,
}: {
  request: Request;
  credential: AuthenticationCredentialJSON;
}) {
  const session = await getSession(request);
  const result = WebAuthnAuthenticationSession.safeParse(
    session.get(AUTHENTICATION_SESSION_KEY)
  );
  if (!result.success) {
    return json(
      { errors: { webauthn: fromZodError(result.error).message } },
      { status: 400 }
    );
  }
  const userID = credential.response.userHandle;
  const user = userID ? await getUserById(userID) : result.data.user;

  if (!user) {
    return json(
      {
        errors: {
          webauthn: 'Authentication verification error (user not found)',
        },
      },
      { status: 400 }
    );
  }

  const { challenge: expectedChallenge, redirectTo } = result.data;
  const url = new URL(request.url);
  const credentialID = credential.id;
  const authenticator = await getAuthenticatorById(user.userName, credentialID);

  if (!authenticator) {
    return json(
      {
        errors: {
          webauthn: 'Authentication verification error (credential not found)',
        },
      },
      { status: 400 }
    );
  }

  const { verified, authenticationInfo } =
    await SimpleWebAuthnServer.verifyAuthenticationResponse({
      credential,
      expectedChallenge,
      expectedRPID: url.hostname,
      expectedOrigin: url.origin,
      requireUserVerification: true,
      authenticator,
    });

  if (!verified) {
    return json(
      {
        errors: { webauthn: 'Authentication verification failed' },
      },
      { status: 400 }
    );
  }

  await updateUserAuthenticatorCounter({
    userID: user.userID,
    credentialID,
    counter: authenticationInfo.newCounter,
  });

  return createUserSession({ session, user, redirectTo });
}

async function registrationResponse({
  session,
  user,
  options,
  redirectTo,
}: {
  session: Session;
  user: WebAuthnUser;
  options: PublicKeyCredentialCreationOptionsJSON;
  redirectTo: string;
}) {
  session.set(REGISTRATION_SESSION_KEY, {
    user,
    challenge: options.challenge,
    redirectTo,
  });
  return json(
    {
      type: 'registration' as const,
      options,
      user,
    },
    {
      headers: {
        'set-cookie': await sessionStorage.commitSession(session, {
          maxAge: SESSION_MAX_AGE,
        }),
      },
    }
  );
}

async function authenticationResponse({
  session,
  user,
  options,
  redirectTo,
}: {
  session: Session;
  user?: WebAuthnUser;
  options: PublicKeyCredentialRequestOptionsJSON;
  redirectTo: string;
}) {
  session.unset(USER_SESSION_KEY);
  session.set(AUTHENTICATION_SESSION_KEY, {
    user,
    challenge: options.challenge,
    redirectTo,
  });
  return json(
    { type: 'authentication' as const, options },
    {
      headers: {
        'set-cookie': await sessionStorage.commitSession(session, {
          maxAge: SESSION_MAX_AGE,
        }),
      },
    }
  );
}

async function createUserSession({
  session,
  user,
  redirectTo,
}: {
  session: Session;
  user: WebAuthnUser;
  redirectTo: string;
}) {
  session.set(USER_SESSION_KEY, user.userID);
  session.unset(REGISTRATION_SESSION_KEY);
  session.unset(AUTHENTICATION_SESSION_KEY);
  return redirect(redirectTo, {
    headers: {
      'set-cookie': await sessionStorage.commitSession(session, {
        maxAge: SESSION_MAX_AGE,
      }),
    },
  });
}
