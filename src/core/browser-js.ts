const MAX_EXPRESSION_BYTES = 64 * 1024;

interface GenerateExpressionParams {
  url: string;
  headers: Record<string, string>;
  body: string;
  bardActivityUrl: string;
  bardActivityHeaders: Record<string, string>;
  bardActivityBody: string;
}

interface BatchExpressionParams {
  url: string;
  headers: Record<string, string>;
  body: string;
}

interface UploadFinalizeExpressionParams {
  uploadId: string;
  filename: string;
  mimeType: string;
  uploadUrl: string;
  snlm0e: string;
  accountIndex: number;
}

function assertExpressionSize(expression: string): void {
  const size = Buffer.byteLength(expression, "utf8");
  if (size > MAX_EXPRESSION_BYTES) {
    throw new Error(`Browser expression exceeds 64KB (${size} bytes)`);
  }
}

function quote(value: unknown): string {
  return JSON.stringify(value);
}

export function buildGenerateExpression(params: GenerateExpressionParams): string {
  const expression = `(async () => {
  const bardActivityUrl = ${quote(params.bardActivityUrl)};
  const bardActivityHeaders = ${quote(params.bardActivityHeaders)};
  const bardActivityBody = ${quote(params.bardActivityBody)};
  const url = ${quote(params.url)};
  const headers = ${quote(params.headers)};
  const body = ${quote(params.body)};

  try {
    const bardRes = await fetch(bardActivityUrl, {
      method: 'POST',
      headers: bardActivityHeaders,
      body: bardActivityBody,
      credentials: 'include'
    });

    if (!bardRes.ok) {
      return { ok: false, error: 'BARD_ACTIVITY failed: ' + bardRes.status };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      credentials: 'include'
    });

    if (!res.ok) {
      return { ok: false, error: 'StreamGenerate failed: ' + res.status };
    }

    const text = await res.text();
    return { ok: true, data: text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
})()`;

  assertExpressionSize(expression);
  return expression;
}

export function buildBatchExpression(params: BatchExpressionParams): string {
  const expression = `(async () => {
  const url = ${quote(params.url)};
  const headers = ${quote(params.headers)};
  const body = ${quote(params.body)};

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      credentials: 'include'
    });

    if (!res.ok) {
      return { ok: false, error: 'BatchExecute failed: ' + res.status };
    }

    const text = await res.text();
    return { ok: true, data: text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
})()`;

  assertExpressionSize(expression);
  return expression;
}

export function buildUploadChunkPushExpression(uploadId: string, chunk: string, chunkIndex: number): string {
  const globalKey = `__cg_upload_${uploadId}`;
  const expression = `(window[${quote(globalKey)}] = window[${quote(globalKey)}] || []).push(${quote(chunk)}); void ${quote(chunkIndex)}; true`;

  assertExpressionSize(expression);
  return expression;
}

export function buildUploadFinalizeExpression(params: UploadFinalizeExpressionParams): string {
  const globalKey = `__cg_upload_${params.uploadId}`;

  const expression = `(async () => {
  const globalKey = ${quote(globalKey)};
  const uploadUrl = ${quote(params.uploadUrl)};
  const filename = ${quote(params.filename)};
  const mimeType = ${quote(params.mimeType)};
  const snlm0e = ${quote(params.snlm0e)};
  const accountIndex = ${quote(params.accountIndex)};

  try {
    const chunks = window[globalKey];
    if (!Array.isArray(chunks)) {
      return { ok: false, error: 'Missing upload chunks' };
    }

    const base64 = chunks.join('');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const separator = uploadUrl.includes('?') ? '&' : '?';
    const startUrl = uploadUrl + separator + 'authuser=' + encodeURIComponent(String(accountIndex)) + '&at=' + encodeURIComponent(snlm0e);

    const startHeaders = {
      Origin: 'https://gemini.google.com',
      Referer: 'https://gemini.google.com/',
      'Push-ID': 'feeds/mcudyrk2a4khkz',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Header-Content-Length': String(bytes.byteLength),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'X-Tenant-ID': 'bard-storage'
    };

    const startRes = await fetch(startUrl, {
      method: 'POST',
      headers: startHeaders,
      body: 'File name: ' + filename,
      credentials: 'include'
    });

    if (!startRes.ok) {
      return { ok: false, error: 'Upload start failed: ' + startRes.status };
    }

    const resumableUrl = startRes.headers.get('x-goog-upload-url');
    if (!resumableUrl) {
      return { ok: false, error: 'Missing x-goog-upload-url header' };
    }

    const finalizeHeaders = {
      Origin: 'https://gemini.google.com',
      Referer: 'https://gemini.google.com/',
      'Push-ID': 'feeds/mcudyrk2a4khkz',
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'X-Tenant-ID': 'bard-storage'
    };

    const finalizeRes = await fetch(resumableUrl, {
      method: 'POST',
      headers: finalizeHeaders,
      body: bytes,
      credentials: 'include'
    });

    if (!finalizeRes.ok) {
      return { ok: false, error: 'Upload finalize failed: ' + finalizeRes.status };
    }

    const responseText = await finalizeRes.text();
    return { ok: true, data: responseText };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  } finally {
    delete window[globalKey];
  }
})()`;

  assertExpressionSize(expression);
  return expression;
}
