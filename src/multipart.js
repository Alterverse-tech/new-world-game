import { HttpError } from './errors.js';

const CRLF = Buffer.from('\r\n');
const HEADER_END = Buffer.from('\r\n\r\n');
const MAX_HEADER_BYTES = 16 * 1024;

async function readBoundedBody(request, maximumBytes) {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new HttpError(413, 'payload_too_large', 'Request body is too large');
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) {
      request.resume();
      throw new HttpError(413, 'payload_too_large', 'Request body is too large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function boundaryFrom(contentType) {
  if (!/^multipart\/form-data\b/i.test(contentType)) {
    throw new HttpError(415, 'unsupported_media_type', 'Expected multipart/form-data');
  }
  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || boundary.length > 200 || /[\r\n]/.test(boundary)) {
    throw new HttpError(400, 'invalid_multipart', 'Multipart boundary is missing or invalid');
  }
  return boundary;
}

function parseHeaders(buffer) {
  const headers = new Map();
  for (const line of buffer.toString('latin1').split('\r\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      throw new HttpError(400, 'invalid_multipart', 'Malformed multipart header');
    }
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (headers.has(name)) {
      throw new HttpError(400, 'invalid_multipart', 'Duplicate multipart header');
    }
    headers.set(name, value);
  }
  return headers;
}

function dispositionParameter(disposition, name) {
  const expression = new RegExp(`(?:^|;)\\s*${name}="([^"]*)"`, 'i');
  return expression.exec(disposition)?.[1];
}

function findNextBoundary(body, marker, start) {
  let cursor = start;
  while (cursor < body.length) {
    const index = body.indexOf(marker, cursor);
    if (index < 0) return -1;
    const suffix = body.subarray(index + marker.length, index + marker.length + 2);
    if (suffix.equals(CRLF) || suffix.equals(Buffer.from('--'))) return index;
    cursor = index + 1;
  }
  return -1;
}

async function readMultipartParts(request, options) {
  const boundary = boundaryFrom(request.headers['content-type'] ?? '');
  const body = await readBoundedBody(request, options.maximumBodyBytes);
  const marker = Buffer.from(`--${boundary}`);
  const nextMarker = Buffer.from(`\r\n--${boundary}`);

  if (!body.subarray(0, marker.length).equals(marker)) {
    throw new HttpError(400, 'invalid_multipart', 'Multipart body has an invalid opening boundary');
  }

  const files = [];
  const fields = new Map();
  let cursor = 0;
  while (cursor < body.length) {
    if (!body.subarray(cursor, cursor + marker.length).equals(marker)) {
      throw new HttpError(400, 'invalid_multipart', 'Malformed multipart boundary');
    }
    cursor += marker.length;

    if (body.subarray(cursor, cursor + 2).equals(Buffer.from('--'))) {
      cursor += 2;
      if (cursor < body.length && !body.subarray(cursor, cursor + 2).equals(CRLF)) {
        throw new HttpError(400, 'invalid_multipart', 'Malformed multipart closing boundary');
      }
      break;
    }
    if (!body.subarray(cursor, cursor + 2).equals(CRLF)) {
      throw new HttpError(400, 'invalid_multipart', 'Malformed multipart separator');
    }
    cursor += 2;

    const headerEnd = body.indexOf(HEADER_END, cursor);
    if (headerEnd < 0 || headerEnd - cursor > MAX_HEADER_BYTES) {
      throw new HttpError(400, 'invalid_multipart', 'Multipart headers are missing or too large');
    }
    const headers = parseHeaders(body.subarray(cursor, headerEnd));
    const dataStart = headerEnd + HEADER_END.length;
    const dataEnd = findNextBoundary(body, nextMarker, dataStart);
    if (dataEnd < 0) {
      throw new HttpError(400, 'invalid_multipart', 'Multipart part is not terminated');
    }

    const disposition = headers.get('content-disposition') ?? '';
    if (!/^form-data\b/i.test(disposition)) {
      throw new HttpError(400, 'invalid_multipart', 'Invalid Content-Disposition');
    }
    const fieldName = dispositionParameter(disposition, 'name');
    const fileName = dispositionParameter(disposition, 'filename');
    if (fileName !== undefined) {
      if (!fieldName || !fileName || /[\\/\0]/.test(fileName)) {
        throw new HttpError(400, 'invalid_multipart', 'Uploaded filename is invalid');
      }
      files.push({
        fieldName,
        fileName,
        contentType: headers.get('content-type') ?? 'application/octet-stream',
        buffer: Buffer.from(body.subarray(dataStart, dataEnd)),
      });
    } else {
      if (!fieldName || /[\0\r\n]/.test(fieldName) || fields.has(fieldName)) {
        throw new HttpError(400, 'invalid_multipart', 'Multipart text field is missing or duplicated');
      }
      const value = body.subarray(dataStart, dataEnd);
      if (value.length > (options.maximumFieldBytes ?? 4 * 1024)) {
        throw new HttpError(413, 'payload_too_large', 'Multipart text field is too large');
      }
      try {
        fields.set(fieldName, new TextDecoder('utf-8', { fatal: true }).decode(value));
      } catch {
        throw new HttpError(400, 'invalid_multipart', 'Multipart text field must use UTF-8');
      }
    }
    cursor = dataEnd + CRLF.length;
  }

  return { files, fields };
}

export async function readMultipartFile(request, options) {
  const { files } = await readMultipartParts(request, options);
  if (files.length !== 1) {
    throw new HttpError(
      400,
      'invalid_upload',
      `Exactly one ${options.fileDescription ?? '.wrlevel'} file is required`,
    );
  }
  return files[0];
}

export async function readMultipartForm(request, options) {
  const { files, fields } = await readMultipartParts(request, options);
  if (files.length !== 1 || (options.fileField && files[0].fieldName !== options.fileField)) {
    throw new HttpError(
      400,
      'invalid_upload',
      `Exactly one ${options.fileDescription ?? 'file'} in field ${options.fileField ?? 'file'} is required`,
    );
  }
  const allowedFields = new Set(options.allowedFields ?? []);
  const requiredFields = new Set(options.requiredFields ?? []);
  const unexpected = [...fields.keys()].filter((field) => !allowedFields.has(field));
  const missing = [...requiredFields].filter((field) => !fields.has(field));
  if (unexpected.length || missing.length) {
    throw new HttpError(422, 'invalid_upload_metadata', 'Multipart text fields are invalid', {
      ...(unexpected.length ? { unexpected } : {}),
      ...(missing.length ? { missing } : {}),
    });
  }
  return {
    file: files[0],
    fields: Object.fromEntries(fields),
  };
}

export async function readJsonBody(request, maximumBytes = 16 * 1024) {
  const body = await readBoundedBody(request, maximumBytes);
  if (body.length === 0) return {};
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be valid JSON');
  }
}
