/**
 * The version stamped into every report.
 *
 * A literal rather than a read of `package.json`: the file sits at a different
 * depth in `src/` than in `dist/`, so resolving it at runtime is the kind of
 * thing that works locally and throws once published. It is stamped into
 * `report.json`, so an artifact can always be traced back to the code that made
 * it — keep it in step with the package version when the CLI is first released.
 */
export const HANDRAIL_VERSION = '0.1.0-dev';
