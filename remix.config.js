/**
 * @type {import('@remix-run/dev').AppConfig}
 */
module.exports = {
  appDirectory: 'app',
  publicPath: '/build/',
  serverModuleFormat: 'cjs',
  serverPlatform: 'node',
  ignoredRouteFiles: ['.*'],
  future: {
    v2_routeConvention: true,
    v2_normalizeFormMethod: true,
    v2_meta: true,
    v2_errorBoundary: true,
    unstable_tailwind: true,
  },
};
