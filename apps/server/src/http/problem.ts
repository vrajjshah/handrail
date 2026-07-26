import { z } from 'zod';

/**
 * One error shape for the whole API, modelled on RFC 9457 problem details.
 *
 * `correlationId` is the scan id wherever there is one, so the string a user
 * can see is the string that indexes the logs. DESIGN.md §9 asks an error state
 * to show it precisely so a bug report can be traced without asking anyone to
 * reproduce anything.
 */
export const ProblemSchema = z.object({
  /** A stable, machine-readable slug. Clients switch on this, never on `title`. */
  code: z.string().min(1),
  title: z.string().min(1),
  /** Plain language, addressed to a person, saying what to do next. */
  detail: z.string().min(1),
  status: z.int().min(400).max(599),
  correlationId: z.string().min(1).optional(),
});
export type Problem = z.infer<typeof ProblemSchema>;

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;

  constructor(status: number, code: string, title: string, detail: string) {
    super(detail);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.title = title;
  }

  toProblem(correlationId?: string): Problem {
    return {
      code: this.code,
      title: this.title,
      detail: this.message,
      status: this.status,
      ...(correlationId === undefined ? {} : { correlationId }),
    };
  }
}

export function notFound(detail: string): HttpError {
  return new HttpError(404, 'not-found', 'Not found', detail);
}

export function badRequest(detail: string): HttpError {
  return new HttpError(400, 'bad-request', 'That request could not be accepted', detail);
}

/**
 * The scan exists but has not produced what was asked for yet.
 *
 * 409 rather than 404: the difference between "no such scan" and "that scan is
 * still running" is the difference between a typo and a wait, and a client that
 * cannot tell them apart will retry the wrong one.
 */
export function notReady(detail: string): HttpError {
  return new HttpError(409, 'not-ready', 'Not ready yet', detail);
}
