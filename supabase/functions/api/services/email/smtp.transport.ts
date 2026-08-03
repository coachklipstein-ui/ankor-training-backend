import type { EmailMessage, EmailSendResult, EmailTransport } from "./email.types.ts";

export type SmtpTransportConfig = {
  readonly host: string;
  readonly port: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const readReply = async (conn: Deno.Conn): Promise<string> => {
  const buffer = new Uint8Array(1024);
  let text = "";

  while (true) {
    const n = await conn.read(buffer);
    if (n === null) {
      break;
    }
    text += decoder.decode(buffer.subarray(0, n));
    // SMTP replies end when the last line has a space after the status code (e.g. "250 OK")
    // Multi-line replies use "-" (e.g. "250-...") until the final "250 ".
    const lines = text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter((line) => line.length > 0);
    const last = lines[lines.length - 1] ?? "";
    if (/^\d{3}[\s-]/.test(last) && !/^\d{3}-/.test(last)) {
      break;
    }
  }

  return text.trim();
};

const expectOk = (reply: string, context: string): void => {
  const code = reply.slice(0, 3);
  if (!code.startsWith("2")) {
    throw new Error(`${context}: ${reply || "empty SMTP reply"}`);
  }
};

const writeLine = async (conn: Deno.Conn, line: string): Promise<void> => {
  await conn.write(encoder.encode(`${line}\r\n`));
};

const extractEmailAddress = (fromOrTo: string): string => {
  const match = fromOrTo.match(/<([^>]+)>/);
  if (match?.[1]) {
    return match[1].trim();
  }
  return fromOrTo.trim();
};

const buildMime = (message: EmailMessage): string => {
  const boundary = `ankor-${crypto.randomUUID()}`;
  const hasText = typeof message.text === "string" && message.text.length > 0;
  const headers = [`From: ${message.from}`, `To: ${message.to}`, `Subject: ${message.subject}`, "MIME-Version: 1.0"];

  if (!hasText) {
    return [...headers, "Content-Type: text/html; charset=utf-8", "", message.html, ""].join("\r\n");
  }

  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    message.text,
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    message.html,
    `--${boundary}--`,
    "",
  ].join("\r\n");
};

const sendViaSmtp = async (config: SmtpTransportConfig, message: EmailMessage): Promise<EmailSendResult> => {
  let conn: Deno.Conn | null = null;
  try {
    conn = await Deno.connect({ hostname: config.host, port: config.port });

    expectOk(await readReply(conn), "SMTP greeting");
    await writeLine(conn, "EHLO localhost");
    expectOk(await readReply(conn), "EHLO");

    const mailFrom = extractEmailAddress(message.from);
    await writeLine(conn, `MAIL FROM:<${mailFrom}>`);
    expectOk(await readReply(conn), "MAIL FROM");

    const rcptTo = extractEmailAddress(message.to);
    await writeLine(conn, `RCPT TO:<${rcptTo}>`);
    expectOk(await readReply(conn), "RCPT TO");

    await writeLine(conn, "DATA");
    const dataReply = await readReply(conn);
    if (!dataReply.startsWith("354")) {
      throw new Error(`DATA: ${dataReply || "empty SMTP reply"}`);
    }

    // Terminate DATA with <CRLF>.<CRLF>; escape lines that start with '.'
    const mime = buildMime(message)
      .replace(/\r\n\./g, "\r\n..")
      .replace(/^\./, "..");
    await conn.write(encoder.encode(`${mime}\r\n.\r\n`));
    expectOk(await readReply(conn), "message body");

    await writeLine(conn, "QUIT");
    await readReply(conn).catch(() => undefined);

    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `SMTP failed: ${error}` };
  } finally {
    try {
      conn?.close();
    } catch {
      // ignore close errors
    }
  }
};

export const createSmtpTransport = (config: SmtpTransportConfig): EmailTransport => {
  const host = config.host.trim();
  if (!host) {
    throw new Error("SMTP_HOST is required for smtp transport");
  }
  if (!Number.isFinite(config.port) || config.port <= 0) {
    throw new Error("SMTP_PORT must be a positive number for smtp transport");
  }

  return {
    send: (message: EmailMessage): Promise<EmailSendResult> => sendViaSmtp({ host, port: config.port }, message),
  };
};
