import { execa } from 'execa';

export interface Opener {
  file: string;
  args: readonly string[];
}

/**
 * The OS's "open this file" command.
 *
 * The platform switch is about *which command exists*, which genuinely differs —
 * it is not the `pnpm` vs `pnpm.cmd` kind of hardcode the plan warns about. That
 * one is a hardcode of an **executable's extension**, and it is exactly what
 * execa removes the need for: it resolves a command to the right binary on
 * Windows without the caller spelling out `.cmd` or `.exe`.
 */
export function openerFor(platform: NodeJS.Platform): Opener {
  if (platform === 'darwin') return { file: 'open', args: [] };
  // `start` is a shell builtin, not a program, and the empty string is the
  // window title `start` would otherwise take the path for.
  if (platform === 'win32') return { file: 'cmd', args: ['/c', 'start', ''] };
  return { file: 'xdg-open', args: [] };
}

export interface OpenOptions {
  platform?: NodeJS.Platform;
  /** Test seam. Nothing in a unit test spawns a process. */
  run?: (file: string, args: readonly string[]) => Promise<unknown>;
}

/** Hand a file to the desktop. Best-effort: the caller warns, it never fails a scan. */
export async function openInBrowser(target: string, options: OpenOptions = {}): Promise<void> {
  const opener = openerFor(options.platform ?? process.platform);
  const run =
    options.run ??
    ((file: string, args: readonly string[]) => execa(file, [...args], { stdio: 'ignore' }));
  await run(opener.file, [...opener.args, target]);
}
