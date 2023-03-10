import { type ActionArgs, json } from '@remix-run/node';
import type { useActionData } from '@remix-run/react';
import { zfd } from 'zod-form-data';
import { z } from 'zod';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/typescript-types';
import { fromZodError } from 'zod-validation-error';

import {
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from '~/session.server';

export type ActionData = NonNullable<
  ReturnType<typeof useActionData<typeof action>>
>;

const RegistrationCredential: z.ZodType<RegistrationResponseJSON> = z.object({
  id: z.string(),
  type: z.literal('public-key'),
  rawId: z.string(),
  response: z.object({
    clientDataJSON: z.string(),
    attestationObject: z.string(),
  }),
  clientExtensionResults: z
    .object({
      appid: z.boolean().optional(),
      hmacCreateSecret: z.boolean().optional(),
      credProps: z.object({ rk: z.boolean().optional() }).optional(),
    })
    .passthrough(),
  transports: z
    .enum(['ble', 'internal', 'nfc', 'usb', 'cable', 'hybrid'])
    .array()
    .optional(),
});

const AuthenticationCredential: z.ZodType<AuthenticationResponseJSON> =
  z.object({
    id: z.string(),
    type: z.literal('public-key'),
    rawId: z.string(),
    response: z.object({
      clientDataJSON: z.string(),
      authenticatorData: z.string(),
      signature: z.string(),
      userHandle: z.string().optional(),
    }),
    clientExtensionResults: z
      .object({
        appid: z.boolean().optional(),
        hmacCreateSecret: z.boolean().optional(),
        credProps: z.object({ rk: z.boolean().optional() }).optional(),
      })
      .passthrough(),
  });

export async function action({ request }: ActionArgs) {
  const formData = await request.formData();
  const result = zfd
    .formData({
      action: z.literal('registration'),
      credential: zfd.json(RegistrationCredential),
    })
    .or(
      zfd.formData({
        action: z.literal('authentication'),
        credential: zfd.json(AuthenticationCredential),
      })
    )
    .safeParse(formData);

  if (result.success) {
    switch (result.data.action) {
      case 'registration':
        return verifyRegistrationResponse({
          request,
          response: result.data.credential,
        });
      case 'authentication':
        return verifyAuthenticationResponse({
          request,
          response: result.data.credential,
        });
    }
  }

  return json(
    { errors: { webauthn: fromZodError(result.error).message } },
    { status: 400 }
  );
}
