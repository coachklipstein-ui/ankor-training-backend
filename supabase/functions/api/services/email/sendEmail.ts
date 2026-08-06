import type { EmailMessage, EmailSendResult } from "./email.types.ts";
import { getEmailTransport } from "./createEmailTransport.ts";

/**
 * Single entry point for outbound mail. Uses the shared transport factory.
 * Failures are logged and returned; callers should not need to catch for delivery errors.
 */
export const sendEmail = async (message: EmailMessage): Promise<EmailSendResult> => {
  try {
    const result = await getEmailTransport().send(message);
    if (!result.ok) {
      console.error("[sendEmail] delivery failed", {
        to: message.to,
        subject: message.subject,
        error: result.error,
      });
    }
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[sendEmail] transport error", {
      to: message.to,
      subject: message.subject,
      error,
    });
    return { ok: false, error };
  }
};
