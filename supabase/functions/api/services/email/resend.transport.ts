import type { EmailMessage, EmailSendResult, EmailTransport } from "./email.types.ts";

export type ResendTransportConfig = {
  readonly apiKey: string;
};

const sendViaResend = async (apiKey: string, message: EmailMessage): Promise<EmailSendResult> => {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: message.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        ...(message.text ? { text: message.text } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Resend failed: ${res.status} ${body}` };
    }

    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Resend failed: ${error}` };
  }
};

export const createResendTransport = (config: ResendTransportConfig): EmailTransport => {
  const apiKey = config.apiKey.trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is required for resend transport");
  }

  return {
    send: (message: EmailMessage): Promise<EmailSendResult> => sendViaResend(apiKey, message),
  };
};
