let handler;

async function getHandler() {
  if (!handler) {
    const mod = await import('./_handler.bundle.js');
    handler = mod.default;
  }
  return handler;
}

export default async function(req, res) {
  const app = await getHandler();

  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = `${protocol}://${host}${req.url}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      value.forEach(v => headers.append(key, v));
    } else {
      headers.set(key, value);
    }
  }

  let body = undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks);
  }

  const fetchRequest = new Request(url, { method: req.method, headers, body });
  const fetchResponse = await app.fetch(fetchRequest);

  res.statusCode = fetchResponse.status;
  fetchResponse.headers.forEach((value, key) => res.setHeader(key, value));

  const buffer = Buffer.from(await fetchResponse.arrayBuffer());
  res.end(buffer);
}
