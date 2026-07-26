/**
 * The post-deploy smoke gate.
 *
 *     pnpm --filter @handrail/server smoke -- https://handrail.example
 *
 * It answers one question — *can this deployment actually scan something?* —
 * and it answers it the only honest way, by making it scan something. Polling
 * `/readyz` alone would pass a deployment whose worker never picks a job up,
 * and that is precisely the failure a deploy introduces.
 *
 * The target is the deployment's own landing page, so the gate needs no third
 * party to be up and the scanner is pointed at something we are allowed to
 * scan. It is also a small dogfood: if our own page fails to capture, the
 * release is broken whatever the report says.
 *
 * Exit 0 for a healthy deploy, 1 for anything else. `deploy.yml` turns a
 * non-zero exit into a rollback.
 */
import { ReportSchema, ScanRecordSchema } from '@handrail/schemas';

interface SmokeOptions {
  baseUrl: string;
  adminToken?: string;
  readyTimeoutMs: number;
  scanTimeoutMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  fetchImpl: typeof fetch;
  log: (message: string) => void;
}

export class SmokeFailure extends Error {
  readonly step: string;

  constructor(step: string, message: string) {
    super(message);
    this.name = 'SmokeFailure';
    this.step = step;
  }
}

/** Wait until `/readyz` is green, or give up loudly. */
export async function waitForReady(options: SmokeOptions): Promise<void> {
  const deadline = options.now() + options.readyTimeoutMs;
  let lastDetail = 'no response yet';

  while (options.now() < deadline) {
    try {
      const response = await options.fetchImpl(`${options.baseUrl}/readyz`);
      if (response.ok) {
        options.log('readyz is green');
        return;
      }
      // The body names which check failed, which is the difference between a
      // useful deploy log and "the smoke test failed".
      lastDetail = (await response.text()).slice(0, 500);
    } catch (error) {
      lastDetail = error instanceof Error ? error.message : String(error);
    }
    await options.sleep(2_000);
  }

  throw new SmokeFailure('readyz', `never became ready. Last response: ${lastDetail}`);
}

/**
 * Submit a scan of the deployment's own landing page and wait for it to finish.
 *
 * The admin token is used when one is configured, so a smoke run does not spend
 * a visitor's three-an-hour allowance on every deploy.
 */
export async function scanSelf(options: SmokeOptions): Promise<{ scanId: string }> {
  const response = await options.fetchImpl(`${options.baseUrl}/api/scans`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.adminToken === undefined ? {} : { 'x-admin-token': options.adminToken }),
    },
    body: JSON.stringify({ url: options.baseUrl, viewports: ['desktop'] }),
  });

  if (response.status !== 202) {
    const body = (await response.text()).slice(0, 500);
    // The most likely local confusion, named rather than left to be puzzled
    // over: the SSRF guard refuses a target that is not publicly resolvable, so
    // a deployment at `localhost` cannot scan itself. That is the guard working,
    // not the smoke failing — this gate is for a public deployment.
    const hint = body.includes('ssrf-')
      ? ' — the SSRF guard refused this deployment\'s own URL, which is expected when it is not publicly resolvable. Point the smoke at a public deployment.'
      : '';
    throw new SmokeFailure('submit', `expected 202, got ${String(response.status)}: ${body}${hint}`);
  }

  const body = (await response.json()) as { scan: unknown };
  const scan = ScanRecordSchema.parse(body.scan);
  options.log(`submitted ${scan.id}`);
  return { scanId: scan.id };
}

export async function waitForScan(scanId: string, options: SmokeOptions): Promise<void> {
  const deadline = options.now() + options.scanTimeoutMs;

  while (options.now() < deadline) {
    const response = await options.fetchImpl(`${options.baseUrl}/api/scans/${scanId}`);
    if (response.ok) {
      const record = ScanRecordSchema.parse(await response.json());
      if (record.status === 'completed') {
        options.log(`scan completed in phase ${record.phase}`);
        return;
      }
      if (record.status === 'failed') {
        throw new SmokeFailure('scan', `the scan failed: ${record.error?.message ?? 'no reason given'}`);
      }
    }
    await options.sleep(3_000);
  }

  throw new SmokeFailure('scan', `the scan did not finish within ${String(options.scanTimeoutMs)}ms`);
}

/**
 * Fetch the report and validate it against the contract.
 *
 * "The scan said completed" is not the same claim as "it produced something a
 * client can read" — a serialization bug shipped in a deploy would satisfy the
 * first and break every consumer.
 */
export async function assertReport(scanId: string, options: SmokeOptions): Promise<void> {
  const response = await options.fetchImpl(`${options.baseUrl}/api/scans/${scanId}/report`);
  if (!response.ok) {
    throw new SmokeFailure('report', `expected 200, got ${String(response.status)}`);
  }

  const report = ReportSchema.parse(await response.json());
  if (report.coverage.criteriaTotal !== 55) {
    throw new SmokeFailure(
      'report',
      `expected all 55 A/AA criteria in the ledger, got ${String(report.coverage.criteriaTotal)}`,
    );
  }
  if (report.coverage.evaluated === 0) {
    // A report that evaluated nothing is what a deployment with a broken
    // browser produces: it completes, and it has measured nothing at all.
    throw new SmokeFailure('report', 'the report evaluated zero criteria');
  }

  options.log(
    `report valid: evaluated ${String(report.coverage.evaluated)} of ` +
      `${String(report.coverage.criteriaTotal)} criteria, ${String(report.findings.length)} finding(s)`,
  );
}

export async function runSmoke(options: SmokeOptions): Promise<void> {
  await waitForReady(options);
  const { scanId } = await scanSelf(options);
  await waitForScan(scanId, options);
  await assertReport(scanId, options);
}

export function defaultOptions(baseUrl: string, env: NodeJS.ProcessEnv): SmokeOptions {
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    ...(env.ADMIN_TOKEN === undefined ? {} : { adminToken: env.ADMIN_TOKEN }),
    readyTimeoutMs: Number(env.SMOKE_READY_TIMEOUT_MS ?? 180_000),
    scanTimeoutMs: Number(env.SMOKE_SCAN_TIMEOUT_MS ?? 300_000),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    fetchImpl: fetch,
    log: (message) => process.stdout.write(`smoke: ${message}\n`),
  };
}

export type { SmokeOptions };
