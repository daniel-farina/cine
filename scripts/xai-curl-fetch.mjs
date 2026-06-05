import { execFile, spawn } from "child_process";
import { Readable } from "stream";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const XAI_RESOLVE = "api.x.ai:443:104.18.19.80";
/** macOS ARG_MAX ~256KB; base64 image JSON must not go on the curl argv. */
const STDIN_BODY_THRESHOLD = 128 * 1024;

function buildCurlArgs(url, init = {}, extra = [], { stdinBody = false } = {}) {
  const method = init.method || "GET";
  const args = ["-sS", "--resolve", XAI_RESOLVE, "-X", method, ...extra];
  const headers = new Headers(init.headers || {});
  for (const [k, v] of headers) args.push("-H", `${k}: ${v}`);
  if (init.body != null && init.body !== "") {
    if (stdinBody) args.push("-d", "@-");
    else args.push("-d", String(init.body));
  }
  args.push(url);
  return args;
}

async function curlBufferedFetch(url, init = {}) {
  const bodyStr = init.body != null ? String(init.body) : "";
  const stdinBody = bodyStr.length > STDIN_BODY_THRESHOLD;
  const args = buildCurlArgs(url, init, ["-w", "\n%{http_code}"], { stdinBody });
  const opts = { maxBuffer: 64 * 1024 * 1024 };
  if (stdinBody) opts.input = bodyStr;
  const { stdout } = await execFileAsync("/usr/bin/curl", args, opts);
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
  const bodyStr = init.body != null ? String(init.body) : "";
  const stdinBody = bodyStr.length > STDIN_BODY_THRESHOLD;
  const args = buildCurlArgs(url, init, ["-N"], { stdinBody });
  const child = spawn(
    "/usr/bin/curl",
    args,
    stdinBody ? { stdio: ["pipe", "pipe", "pipe"] } : undefined
  );
  if (stdinBody) {
    child.stdin.write(bodyStr);
    child.stdin.end();
  }
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