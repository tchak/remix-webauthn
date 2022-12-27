import type { LoaderArgs, ActionArgs } from '@remix-run/node';

import { logout } from '~/session.server';

export async function loader({ request }: LoaderArgs) {
  return logout(request);
}

export async function action({ request }: ActionArgs) {
  return logout(request);
}
