/**
 * The version this deployment reports and stamps into the reports it serves.
 *
 * A literal for the same reason the CLI's is: `package.json` sits at a
 * different depth in `src/` than in `dist/`, so resolving it at runtime is the
 * kind of thing that works locally and throws once containerised.
 */
export const HANDRAIL_VERSION = '0.1.0-dev';
