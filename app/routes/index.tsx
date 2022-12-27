import { type LoaderArgs, type ActionArgs, json } from '@remix-run/node';
import { Link, Form, useLoaderData, useFetcher } from '@remix-run/react';
import { zfd } from 'zod-form-data';

import { useWebAuthn } from '~/webauthn';
import { getUser, requireUser } from '~/session.server';
import {
  getAuthenticatorsByEmail,
  deleteAuthenticatorById,
} from '~/models/user.server';

export async function loader({ request }: LoaderArgs) {
  const user = await getUser(request);
  if (user) {
    const authenticators = await getAuthenticatorsByEmail(user.userName);
    return json({
      user,
      authenticators: authenticators.map(({ credentialID, transports }) => ({
        id: credentialID.toString('base64url'),
        transports: transports?.join(', ') ?? '',
      })),
    });
  }
  return json({ user: null });
}

export async function action({ request }: ActionArgs) {
  const user = await requireUser(request);
  const formData = await request.formData();
  const credential = zfd
    .formData({ credentialID: zfd.text() })
    .safeParse(formData);

  if (credential.success) {
    await deleteAuthenticatorById({
      userID: user.userID,
      credentialID: credential.data.credentialID,
    });
  }

  return json({ ok: true });
}

export default function Index() {
  const loaderData = useLoaderData<typeof loader>();

  return (
    <main className="relative min-h-screen bg-white sm:flex sm:items-center sm:justify-center">
      <div className="relative sm:pb-16 sm:pt-8">
        <div className="mx-auto max-w-7xl sm:px-6 lg:px-8">
          <div className="relative shadow-xl sm:overflow-hidden sm:rounded-2xl">
            <div className="absolute inset-0">
              <div className="absolute inset-0 bg-[color:rgba(27,167,254,0.5)] mix-blend-multiply" />
            </div>
            <div className="relative px-4 pt-16 pb-8 sm:px-6 sm:pt-24 sm:pb-14 lg:px-8 lg:pb-20 lg:pt-32">
              <h1 className="text-center text-6xl font-extrabold tracking-tight sm:text-8xl lg:text-9xl">
                <span className="block uppercase text-blue-500 drop-shadow-md">
                  WebAuthn
                </span>
              </h1>
              <p className="mx-auto mt-6 max-w-lg text-center text-xl text-white sm:max-w-3xl"></p>
              <div className="mx-auto mt-10 max-w-sm sm:flex sm:max-w-none sm:justify-center">
                {loaderData.user ? (
                  <AuthenticatedCard />
                ) : (
                  <div>
                    <Link
                      to="/login"
                      className="flex items-center justify-center rounded-md border border-transparent bg-white px-2 py-2 text-sm font-medium text-blue-700 shadow-sm hover:bg-blue-50 sm:px-8"
                    >
                      Log In
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl py-2 px-4 sm:px-6 lg:px-8"></div>
      </div>
    </main>
  );
}

function AuthenticatedCard() {
  const { login, isAuthorizing, error } = useWebAuthn();
  const loaderData = useLoaderData<typeof loader>();

  if (loaderData.user) {
    return (
      <div className="flex flex-col mx-auto w-full max-w-md px-8">
        <h2 className="font-medium text-blue-900">
          <strong>Logged In:</strong> {loaderData.user.userName}
        </h2>
        <AuthenticatorList authenticators={loaderData.authenticators} />
        <div className="flex gap-2 justify-between">
          <button
            type="button"
            className="flex items-center justify-center rounded-md border border-transparent bg-white px-2 py-2 text-sm font-medium text-blue-700 shadow-sm hover:bg-blue-50 sm:px-8"
            onClick={() => login()}
            disabled={isAuthorizing}
          >
            Add credential
          </button>
          <Form method="post" action="/logout">
            <button
              type="submit"
              className="flex items-center justify-center rounded-md border border-transparent bg-white px-2 py-2 text-sm font-medium text-blue-700 shadow-sm hover:bg-blue-50 sm:px-8"
            >
              Log Out
            </button>
          </Form>
        </div>
        {error && (
          <div className="pt-1 text-red-700" id="email-error">
            {error}
          </div>
        )}
      </div>
    );
  }
  return null;
}

function AuthenticatorList({
  authenticators,
}: {
  authenticators: { id: string; transports: string }[];
}) {
  return (
    <ul className="divide-y divide-blue-300">
      {authenticators.map((authenticator) => (
        <AuthenticatorItem
          key={authenticator.id}
          authenticator={authenticator}
          canRemove={authenticators.length > 1}
        />
      ))}
    </ul>
  );
}

function AuthenticatorItem({
  authenticator,
  canRemove,
}: {
  authenticator: { id: string; transports: string };
  canRemove: boolean;
}) {
  const fetcher = useFetcher();
  const deleting = fetcher.state == 'submitting';

  return (
    <li
      className={`flex py-4${
        deleting ? ' hidden' : ''
      } ml-3 items-center space-x-4`}
    >
      <div className="min-w-0 flex-1">
        <p
          className="text-sm font-medium text-blue-900"
          title={authenticator.id}
        >
          {authenticator.id.slice(0, 8)}[...]
        </p>
        <p className="text-sm text-blue-500">{authenticator.transports}</p>
      </div>
      {canRemove ? (
        <fetcher.Form method="post">
          <input type="hidden" name="credentialID" value={authenticator.id} />
          <button
            type="submit"
            className="inline-flex items-center rounded-full border border-gray-300 bg-white px-2.5 py-0.5 text-sm font-medium leading-5 text-gray-500 shadow-sm hover:bg-gray-50"
            disabled={deleting}
          >
            Remove
          </button>
        </fetcher.Form>
      ) : null}
    </li>
  );
}
