import { type LoaderArgs, type MetaFunction, json } from '@remix-run/node';
import { useSearchParams } from '@remix-run/react';
import { useEffect, useRef } from 'react';
import { zfd } from 'zod-form-data';
import { useEffectOnce } from 'usehooks-ts';

import { requireNoUser } from '~/session.server';
import { useWebAuthn } from '~/webauthn';

export async function loader({ request }: LoaderArgs) {
  await requireNoUser(request);
  return json(null);
}

export const meta: MetaFunction = () => {
  return { title: 'Log In' };
};

export default function LogIn() {
  const { login, isAuthorizing, error } = useWebAuthn();
  const emailRef = useRef<HTMLInputElement>(null);
  const loginWithForm = () => {
    if (emailRef.current?.form) {
      login(new FormData(emailRef.current.form));
    }
  };
  const [searchParams] = useSearchParams();
  const redirectTo = zfd
    .formData({ redirectTo: zfd.text().nullish() })
    .parse(searchParams).redirectTo;

  useEffect(() => {
    if (error) {
      emailRef.current?.focus();
    }
  }, [error]);

  const autofillRef = useRef(false);
  useEffectOnce(() => {
    if (!autofillRef.current) {
      autofillRef.current = true;
      const formData = new FormData();
      if (redirectTo) {
        formData.set('redirectTo', redirectTo);
      }
      formData.set('autofill', 'true');
      login(formData);
    }
  });

  return (
    <div className="flex min-h-full flex-col justify-center">
      <div className="mx-auto w-full max-w-md px-8">
        <form
          method="post"
          className="space-y-6"
          noValidate
          onSubmit={(event) => event.preventDefault()}
        >
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700"
            >
              Email address
            </label>
            <div className="mt-1">
              <input
                ref={emailRef}
                id="email"
                required
                autoFocus={true}
                name="email"
                type="email"
                autoComplete="webauthn username"
                autoCapitalize="off"
                autoCorrect="off"
                disabled={isAuthorizing}
                aria-invalid={error ? true : undefined}
                aria-describedby="email-error"
                className="w-full rounded border border-gray-500 px-2 py-1 text-lg"
                onKeyDown={(event) => {
                  if (event.key == 'Enter') {
                    loginWithForm();
                  }
                }}
              />
              {error && (
                <div className="pt-1 text-red-700" id="email-error">
                  {error}
                </div>
              )}
            </div>
          </div>

          {redirectTo ? (
            <input type="hidden" name="redirectTo" value={redirectTo} />
          ) : null}
          <button
            type="submit"
            onClick={() => loginWithForm()}
            disabled={isAuthorizing}
            className="w-full rounded bg-blue-500  py-2 px-4 text-white hover:bg-blue-600 focus:bg-blue-400"
          >
            Log In
          </button>
        </form>
      </div>
    </div>
  );
}
