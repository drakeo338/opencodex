/**
 * #6276: in a compiled `ocx` binary `import.meta.dir` is a virtual `/$bunfs/...` path, so the
 * shim used to bake `<ocx> /$bunfs/root/src/cli/index.ts ensure`. The standalone CLI reads that
 * path as an unknown command and every Codex launch reported "proxy autostart failed".
 * A standalone runtime already is the CLI, so the shim must call it with just `ensure`.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildUnixCodexShim, buildWindowsCodexShim, buildWindowsPowerShellCodexShim } from "../../src/codex/shim";
import { removeTreeWithRetry } from "../helpers/remove-tree";
import { INTERNAL_DEADLINE_MS, SPAWN_BUDGET_MS } from "../helpers/test-budget";

const VIRTUAL_CLI = "/$bunfs/root/src/cli/index.ts";

describe("Codex shim under a standalone ocx binary (#6276)", () => {
  test.skipIf(process.platform === "win32")("the Unix shim runs the binary with only `ensure`", () => {
    const dir = mkdtempSync(join(tmpdir(), "ocx-shim-standalone-"));
    try {
      const argvFile = join(dir, "argv");
      const realCodex = join(dir, "codex-real");
      writeFileSync(realCodex, "#!/bin/sh\nexit 0\n");
      chmodSync(realCodex, 0o755);
      const fakeOcx = join(dir, "ocx");
      writeFileSync(fakeOcx, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argvFile)}\n`);
      chmodSync(fakeOcx, 0o755);

      const script = buildUnixCodexShim(realCodex, fakeOcx, VIRTUAL_CLI, "standalone", join(dir, "absent-token"));
      expect(script).not.toContain("$bunfs");

      const wrapper = join(dir, "codex");
      writeFileSync(wrapper, script);
      chmodSync(wrapper, 0o755);
      const env: NodeJS.ProcessEnv = { ...process.env, OCX_SHIM_BYPASS: "" };
      for (const key of ["OCX_SHIM_ACTIVE_PID", "OCX_SHIM_ACTIVE_DEPTH", "OCX_SHIM_PROBE_ACTIVE"]) delete env[key];
      const run = spawnSync("/bin/sh", [wrapper, "exec", "hello"], { encoding: "utf8", env, timeout: INTERNAL_DEADLINE_MS });

      expect(run.error).toBeUndefined();
      expect(readFileSync(argvFile, "utf8")).toBe("ensure\n");
    } finally {
      removeTreeWithRetry(dir);
    }
  }, SPAWN_BUDGET_MS);

  test("the Windows shims omit the virtual CLI path too", () => {
    const cmd = buildWindowsCodexShim("C:\\Tools\\codex-real.exe", "C:\\Program Files\\OpenCodex\\ocx.exe", "C:/~BUN/root/src/cli/index.ts", "standalone");
    expect(cmd).not.toContain("~BUN");
    expect(cmd).toContain('"%OCX_BUN%" ensure >nul 2>nul');

    const ps = buildWindowsPowerShellCodexShim("C:\\Tools\\codex-real.exe", "C:\\Program Files\\OpenCodex\\ocx.exe", "C:/~BUN/root/src/cli/index.ts", "standalone");
    expect(ps).not.toContain("~BUN");
    expect(ps).toContain("& 'C:\\Program Files\\OpenCodex\\ocx.exe' ensure *> $null");
  });

  test("a non-standalone runtime still passes the CLI entry", () => {
    const script = buildUnixCodexShim("/usr/local/bin/codex-real", "/usr/local/bin/bun", "/opt/opencodex/src/cli/index.ts", "bundled");
    expect(script).toContain("'/usr/local/bin/bun' '/opt/opencodex/src/cli/index.ts' ensure");
  });
});
