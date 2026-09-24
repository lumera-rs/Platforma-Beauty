import type { ChildProcess } from "node:child_process";

const postgresUrlPattern = /\bpostgres(?:ql)?:\/\/[^\s"'`]+/gi;
const maximumBufferedOutputBytes = 64 * 1024;

function sensitiveDatabaseValues(environment: NodeJS.ProcessEnv): string[] {
  return Object.entries(environment)
    .filter(([key, value]) => Boolean(value) && /(?:^|_)DATABASE_URL$/.test(key))
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length);
}

export function redactDatabaseCommandOutput(
  value: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  let redacted = value;
  for (const sensitiveValue of sensitiveDatabaseValues(environment)) {
    redacted = redacted.replaceAll(sensitiveValue, "<redacted-database-url>");
  }
  return redacted.replace(postgresUrlPattern, "<redacted-database-url>");
}

export interface RedactedOutputWriter {
  write(chunk: Buffer | string): void;
  flush(): void;
}

export function createRedactedDatabaseOutputWriter(
  environment: NodeJS.ProcessEnv,
  destination: Pick<NodeJS.WriteStream, "write">,
): RedactedOutputWriter {
  let buffered = "";
  const writeSafe = (value: string) => {
    if (value) destination.write(redactDatabaseCommandOutput(value, environment));
  };

  return {
    write(chunk) {
      buffered += chunk.toString();
      const lastLineBreak = buffered.lastIndexOf("\n");
      if (lastLineBreak >= 0) {
        writeSafe(buffered.slice(0, lastLineBreak + 1));
        buffered = buffered.slice(lastLineBreak + 1);
      }
      if (Buffer.byteLength(buffered) > maximumBufferedOutputBytes) {
        const retainedCharacters = Math.min(
          maximumBufferedOutputBytes / 2,
          Math.max(
            4_096,
            ...sensitiveDatabaseValues(environment).map((value) => value.length + 1),
          ),
        );
        const flushThrough = Math.max(0, buffered.length - retainedCharacters);
        writeSafe(buffered.slice(0, flushThrough));
        buffered = buffered.slice(flushThrough);
      }
    },
    flush() {
      writeSafe(buffered);
      buffered = "";
    },
  };
}

export function pipeRedactedDatabaseOutput(
  child: ChildProcess,
  environment: NodeJS.ProcessEnv,
  stdoutDestination: Pick<NodeJS.WriteStream, "write"> = process.stdout,
  stderrDestination: Pick<NodeJS.WriteStream, "write"> = process.stderr,
): void {
  const stdout = createRedactedDatabaseOutputWriter(environment, stdoutDestination);
  const stderr = createRedactedDatabaseOutputWriter(environment, stderrDestination);
  child.stdout?.on("data", (chunk: Buffer) => stdout.write(chunk));
  child.stderr?.on("data", (chunk: Buffer) => stderr.write(chunk));
  child.once("close", () => {
    stdout.flush();
    stderr.flush();
  });
}

export function formatDatabaseCommandFailure(
  label: string,
  error: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): Error {
  const failure = error as {
    code?: number | string;
    signal?: NodeJS.Signals;
    stderr?: string | Buffer;
    stdout?: string | Buffer;
    message?: string;
  };
  const reason = failure.signal
    ? `signal ${failure.signal}`
    : failure.code !== undefined
      ? `exit code ${failure.code}`
      : failure.message || "unknown error";
  const details = [failure.stderr, failure.stdout]
    .map((output) => output?.toString().trim() ?? "")
    .filter(Boolean)
    .join("\n");
  const safeDetails = redactDatabaseCommandOutput(details, environment);
  const formatted = new Error(
    `${label} failed (${redactDatabaseCommandOutput(String(reason), environment)})${
      safeDetails ? `:\n${safeDetails}` : "."
    }`,
  );
  return Object.assign(formatted, {
    code: failure.code,
    signal: failure.signal,
    stderr: redactDatabaseCommandOutput(failure.stderr?.toString() ?? "", environment),
    stdout: redactDatabaseCommandOutput(failure.stdout?.toString() ?? "", environment),
  });
}