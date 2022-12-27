import { startRegistration, startAuthentication } from '~/webauthn.client';
import { useEffect, useReducer } from 'react';
import { useFetcher } from '@remix-run/react';
import { useTimeout } from 'usehooks-ts';

import { assignReducer } from '~/utils';
import type { ActionData as InitializeActionData } from '~/routes/webauthn.initialize';
import type { ActionData as VerifyActionData } from '~/routes/webauthn.verify';

type UseWebAuthn = {
  isAuthorizing: boolean;
  error: string | null;
  login(formData?: FormData): void;
};

export function useWebAuthn(): UseWebAuthn {
  const [{ error, isAuthorizing }, dispatch] = useReducer(
    assignReducer<{
      isAuthorizing: boolean;
      error: string | null;
    }>,
    { isAuthorizing: false, error: null }
  );
  const verifyFetcher = useFetcher<VerifyActionData>();

  useEffect(() => {
    if (verifyFetcher.type == 'done') {
      dispatch({
        isAuthorizing: false,
        error: verifyFetcher.data.errors.webauthn,
      });
    }
  }, [verifyFetcher]);

  useTimeout(() => dispatch({ error: null }), error ? 8_000 : null);

  return {
    isAuthorizing,
    error,
    async login(formData) {
      const autofill = !!formData?.get('autofill');

      if (!autofill) {
        dispatch({ isAuthorizing: true, error: null });
      }
      try {
        const init = await initialize(formData);

        if ('errors' in init) {
          dispatch({ isAuthorizing: false, error: init.errors.webauthn });
        } else if (init.type == 'registration' && !autofill) {
          const credential = await startRegistration(init.options);
          verifyFetcher.submit(
            {
              action: 'registration',
              credential: JSON.stringify(credential),
            },
            {
              method: 'post',
              action: '/webauthn/verify',
            }
          );
        } else if (init.type == 'authentication') {
          const credential = await startAuthentication(init.options, autofill);
          if (autofill) {
            dispatch({ isAuthorizing: true, error: null });
          }
          verifyFetcher.submit(
            {
              action: 'authentication',
              credential: JSON.stringify(credential),
            },
            {
              method: 'post',
              action: '/webauthn/verify',
            }
          );
        }
      } catch (error) {
        dispatch({
          isAuthorizing: false,
          error: (error as Error).message,
        });
      }
    },
  };
}

function initialize(formData?: FormData): Promise<InitializeActionData> {
  const headers = new Headers({ accept: 'application/json' });
  if (!formData) {
    headers.set('content-type', 'application/x-www-form-urlencoded');
  }
  return fetch('/webauthn/initialize', {
    method: 'post',
    body: formData,
    headers,
  }).then((response) => {
    if (response.ok) {
      return response.json();
    }
    throw new Error(response.statusText);
  });
}
