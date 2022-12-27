import { type ActionArgs, json } from '@remix-run/node';
import type { useActionData } from '@remix-run/react';
import { zfd } from 'zod-form-data';
import { z } from 'zod';
import { fromZodError } from 'zod-validation-error';

import {
  getUser,
  generateRegistrationOptions,
  generateAuthenticationOptions,
} from '~/session.server';
import { getUserByEmail, newUser } from '~/models/user.server';
import { safeRedirect } from '~/utils';

export type ActionData = NonNullable<
  ReturnType<typeof useActionData<typeof action>>
>;

export async function action({ request }: ActionArgs) {
  const formData = await request.formData();
  const { autofill, redirectTo } = zfd
    .formData({
      redirectTo: zfd
        .text()
        .nullish()
        .transform((redirectTo) => safeRedirect(redirectTo, '/')),
      autofill: zfd.checkbox({ trueValue: 'true' }).nullish(),
    })
    .parse(formData);

  // This is an autofill request
  if (autofill) {
    return generateAuthenticationOptions({ request, redirectTo });
  }

  const loggedInUser = await getUser(request);

  // This is a request to add a new credential to an existing user
  if (loggedInUser) {
    return generateRegistrationOptions({
      request,
      user: loggedInUser,
      redirectTo,
      rpName: 'Remix WebAuthn',
    });
  }

  const emailFormData = zfd
    .formData({ email: z.string().email() })
    .safeParse(formData);

  // The email to register with is invalid
  if (!emailFormData.success) {
    return json({
      errors: { webauthn: fromZodError(emailFormData.error).message },
    });
  }

  const email = emailFormData.data.email;
  const existingUser = await getUserByEmail(email);

  // The user already exists, so we'll authenticate them
  if (existingUser) {
    return generateAuthenticationOptions({
      request,
      user: existingUser,
      redirectTo,
    });
  }

  // The user doesn't exist, so we'll register them
  return generateRegistrationOptions({
    request,
    user: newUser(email),
    redirectTo,
    rpName: 'Remix WebAuthn',
  });
}
