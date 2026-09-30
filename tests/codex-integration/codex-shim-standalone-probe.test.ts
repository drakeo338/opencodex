import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHIM_MARKER } from "../../src/codex/shim-templates";
import { installCodexShim, setCodexShimProbeObservationMsForTests } from "../../src/codex/shim";
import { removeTreeWithRetry } from "../helpers/remove-tree";
import { prependPath } from "../helpers/codex-shim-install-fixture";

afterEach(() => setCodexShimProbeObservationMsForTests(null));

describe("Unix install probe from a standalone executable (#6276)", () => {
  test.skipIf(process.platform === "win32")(
    "re-enters the compiled binary as Bun instead of treating -e as a CLI command",
    () => {
      setCodexShimProbeObservationMsForTests(20);
      const binDir = mkdtempSync(join(tmpdir(), "ocx-shim-standalone-bin-"));
      const home = mkdtempSync(join(tmpdir(), "ocx-shim-standalone-home-"));
      const oldPath = process.env.PATH;
      const oldHome = process.env.OPENCODEX_HOME;
      const realExecPath = process.execPath;
      const codexPath = join(binDir, "codex");
      // A compiled `ocx` only behaves as the Bun interpreter when BUN_BE_BUN=1 is set;
      // otherwise it parses `-e` as an unknown CLI command and exits 1.
      const standalone = join(binDir, "ocx-standalone");
      writeFileSync(
        standalone,
        `#!/bin/sh\nif [ "$BUN_BE_BUN" = "1" ]; then exec "${realExecPath}" "$@"; fi\necho "Unknown command: $1" >&2\nexit 1\n`,
        "utf8",
      );
      chmodSync(standalone, 0o755);
      try {
        process.env.PATH = prependPath(binDir, oldPath);
        process.env.OPENCODEX_HOME = home;
        writeFileSync(codexPath, "#!/bin/sh\necho standalone-valid-launcher\n", "utf8");
        chmodSync(codexPath, 0o755);
        Object.defineProperty(process, "execPath", { value: standalone, configurable: true });

        const installed = installCodexShim();

        expect(installed.message ?? "").not.toContain("phase=group-id");
        expect(installed.installed, installed.message).toBe(true);
        expect(readFileSync(codexPath, "utf8")).toContain(SHIM_MARKER);
        expect(existsSync(join(home, "codex-shim.json"))).toBe(true);
      } finally {
        Object.defineProperty(process, "execPath", { value: realExecPath, configurable: true });
        if (oldPath === undefined) delete process.env.PATH;
        else process.env.PATH = oldPath;
        if (oldHome === undefined) delete process.env.OPENCODEX_HOME;
        else process.env.OPENCODEX_HOME = oldHome;
        removeTreeWithRetry(binDir);
        removeTreeWithRetry(home);
      }
    },
  );
});
