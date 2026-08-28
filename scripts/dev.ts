const commands = ["dev:server", "dev:client"] as const;

const processes = commands.map((script) =>
  Bun.spawn(["bun", "run", script], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }),
);

let shuttingDown = false;

function shutdown(exitCode: number) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of processes) {
    if (child.exitCode === null) child.kill();
  }

  process.exit(exitCode);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const results = await Promise.all(
  processes.map(async (child) => ({ child, exitCode: await child.exited })),
);

const failed = results.find(({ exitCode }) => exitCode !== 0);
shutdown(failed?.exitCode ?? 0);
