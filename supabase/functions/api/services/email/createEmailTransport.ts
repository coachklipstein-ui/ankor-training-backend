import { EMAIL_TRANSPORT, RESEND_API_KEY, SMTP_HOST, SMTP_PORT } from "../../config/env.ts";
import { EmailTransportKind, type EmailTransport } from "./email.types.ts";
import { createResendTransport } from "./resend.transport.ts";
import { createSmtpTransport } from "./smtp.transport.ts";

const parseTransportKind = (raw: string): EmailTransportKind => {
  const value = raw.trim().toLowerCase();
  if (value === EmailTransportKind.Smtp) return EmailTransportKind.Smtp;
  if (value === EmailTransportKind.Resend) return EmailTransportKind.Resend;
  return EmailTransportKind.Auto;
};

const resolveTransportKind = (): EmailTransportKind => {
  const explicit = parseTransportKind(EMAIL_TRANSPORT);
  if (explicit !== EmailTransportKind.Auto) {
    return explicit;
  }

  const hasSmtp = SMTP_HOST.trim().length > 0 && SMTP_PORT.trim().length > 0;
  return hasSmtp ? EmailTransportKind.Smtp : EmailTransportKind.Resend;
};

let cached: EmailTransport | null = null;

export const createEmailTransport = (): EmailTransport => {
  const kind = resolveTransportKind();

  if (kind === EmailTransportKind.Smtp) {
    const port = Number(SMTP_PORT);
    return createSmtpTransport({ host: SMTP_HOST, port });
  }

  return createResendTransport({ apiKey: RESEND_API_KEY });
};

/** Shared transport for every mailer. Lazily created once per isolate. */
export const getEmailTransport = (): EmailTransport => {
  if (!cached) {
    cached = createEmailTransport();
  }
  return cached;
};
