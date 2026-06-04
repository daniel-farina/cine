import { execFile, spawn } from "child_process";
import { Readable } from "stream";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const XAI_RESOLVE = "api.x.ai:443:104.18.19.80";

function buildCurlArgs(url, init = {}, extra = []) {
  const method = init.method || "GET";
  const args = ["-sS", "--resolve", XAI_RESOLVE, "-X", method, ...extra];
  const headers = new Headers(init.headers || {});
  for (const [k, v] of headers) args.push("-H", `${k}: ${v}`);
  if (init.body) args.push("-d", String(init.body));
  args.push(url);
  return args;
}

async function curlBufferedFetch(url, init = {}) {
  const args = buildCurlArgs(url, init, ["-w", "\n%{http_code}"]);
  const { stdout } = await execFileAsync("/usr/bin/curl", args, {
    maxBuffer: 64 * 1024 * 1024,
  });
  const nl = stdout.lastIndexOf("\n");
  const body = nl >= 0 ? stdout.slice(0, nl) : stdout;
  const status = nl >= 0 ? Number(stdout.slice(nl + 1)) : 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => (body ? JSON.parse(body) : {}),
    text: async () => body,
  };
}

function curlStreamFetch(url, init = {}) {
  const child = spawn("/usr/bin/curl", buildCurlArgs(url, init, ["-N"]));
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    body: Readable.toWeb(child.stdout),
    json: async () => {
      throw new Error("Streaming response");
    },
  });
}

/** fetch() compatible client using curl --resolve (works when PM2 DNS is broken). */
export function createCurlFetch() {
  return async function curlFetch(url, init = {}) {
    let streaming = false;
    if (init.body) {
      try {
        streaming = JSON.parse(String(init.body))?.stream === true;
      } catch {
        streaming = false;
      }
    }
    if (streaming) return curlStreamFetch(url, init);
    return curlBufferedFetch(url, init);
  };
}