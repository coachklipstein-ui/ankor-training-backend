export type EmailMessage = {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly html: string;
  readonly text?: string;
};

export type EmailSendResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export type EmailTransport = {
  readonly send: (message: EmailMessage) => Promise<EmailSendResult>;
};

export const EmailTransportKind = {
  Auto: "auto",
  Smtp: "smtp",
  Resend: "resend",
} as const;

export type EmailTransportKind = (typeof EmailTransportKind)[keyof typeof EmailTransportKind];
