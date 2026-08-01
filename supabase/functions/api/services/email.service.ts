import { INVITE_REDIRECT_URL, RESEND_API_KEY, RESEND_FROM } from "../config/env.ts";
import { sbAdmin } from "./supabase.ts";

type AuthLinkType = "invite" | "magiclink" | "recovery" | "signup";

type AuthLinkOptions = {
  type?: AuthLinkType;
  redirectTo?: string;
  data?: Record<string, unknown>;
};

type WelcomeEmailOptions = {
  from?: string;
  subject?: string;
};

export type EvaluationReportEmailInput = {
  to: string;
  athleteFirstName?: string | null;
  coachName?: string | null;
  appName?: string | null;
  evaluationTitle?: string | null;
  evaluationDate?: string | null;
  teamOrOrgName?: string | null;
  evaluationLink?: string | null;
  subject?: string;
};

export type BulkEvaluationReportOptions = {
  subject?: string;
  appName?: string;
};

export type BulkEvaluationReportFailure = {
  to: string;
  error: string;
};

export type BulkEvaluationReportResult = {
  sent: number;
  failed: BulkEvaluationReportFailure[];
};

function requireValue(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${name} is required`);
  }
  return trimmed;
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

type NormalizedEvaluationReportPayload = {
  to: string;
  from: string;
  subject: string;
  athleteFirstName: string;
  coachName: string;
  appName: string;
  evaluationTitle: string;
  evaluationDate: string;
  teamOrOrgName: string;
  evaluationLink: string;
};

function readReportValue(item: EvaluationReportEmailInput, key: string): string {
  const values = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
  const value = values[key];
  if (typeof value === "string") return value.trim();
  return "";
}

function normalizeEvaluationReportPayload(
  item: EvaluationReportEmailInput,
  defaults: { from: string; subject: string; appName: string },
): NormalizedEvaluationReportPayload {
  const to = requireValue(typeof item?.to === "string" ? item.to : "", "to");

  const athleteFirstNameRaw = readReportValue(item, "athleteFirstName");
  const athleteFirstName = athleteFirstNameRaw || "there";

  const coachName = requireValue(readReportValue(item, "coachName"), "coachName");
  const appName = requireValue(readReportValue(item, "appName") || defaults.appName, "appName");
  const evaluationTitle = requireValue(readReportValue(item, "evaluationTitle"), "evaluationTitle");
  const evaluationDate = requireValue(readReportValue(item, "evaluationDate"), "evaluationDate");
  const teamOrOrgName = requireValue(readReportValue(item, "teamOrOrgName"), "teamOrOrgName");
  const evaluationLink = requireValue(readReportValue(item, "evaluationLink"), "evaluationLink");

  const from = requireValue(defaults.from, "RESEND_FROM");
  const subjectRaw = typeof item.subject === "string" ? item.subject.trim() : "";
  const subject = subjectRaw || defaults.subject;

  return {
    to,
    from,
    subject,
    athleteFirstName,
    coachName,
    appName,
    evaluationTitle,
    evaluationDate,
    teamOrOrgName,
    evaluationLink,
  };
}

function buildEvaluationReportEmailHtml(
  payload: Omit<NormalizedEvaluationReportPayload, "to" | "from" | "subject">,
): string {
  const safeAthleteFirstName = escapeHtml(payload.athleteFirstName);
  const safeCoachName = escapeHtml(payload.coachName);
  const safeAppName = escapeHtml(payload.appName);
  const safeEvaluationTitle = escapeHtml(payload.evaluationTitle);
  const safeEvaluationDate = escapeHtml(payload.evaluationDate);
  const safeTeamOrOrgName = escapeHtml(payload.teamOrOrgName);
  const safeEvaluationLink = escapeHtml(payload.evaluationLink);

  return `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;">
      <p>Hi ${safeAthleteFirstName},</p>
      <p>
        A new evaluation has been submitted by Coach ${safeCoachName} and is now
        available in your ${safeAppName} account.
      </p>
      <h3>Summary</h3>
      <p>
        <strong>Evaluation:</strong> ${safeEvaluationTitle}<br/>
        <strong>Date submitted:</strong> ${safeEvaluationDate}<br/>
        <strong>Team/Organization:</strong> ${safeTeamOrOrgName}
      </p>
      <p>
        You can review the full evaluation, ratings, and coach feedback here:<br/>
        <a href="${safeEvaluationLink}">${safeEvaluationLink}</a>
      </p>
      <p>
        If you have questions about the feedback, reply to this email or message
        your coach in the app.
      </p>
      <p>Regards,<br/>${safeAppName} Support</p>
    </div>
  `;
}

function buildEvaluationReportEmailText(
  payload: Omit<NormalizedEvaluationReportPayload, "to" | "from" | "subject">,
): string {
  return `Hi ${payload.athleteFirstName},

A new evaluation has been submitted by Coach ${payload.coachName} and is now available in your ${payload.appName} account.

Summary
Evaluation: ${payload.evaluationTitle}
Date submitted: ${payload.evaluationDate}
Team/Organization: ${payload.teamOrOrgName}

You can review the full evaluation, ratings, and coach feedback here:
${payload.evaluationLink}

If you have questions about the feedback, reply to this email or message your coach in the app.

Regards,
${payload.appName} Support`;
}

export async function generateAuthLink(
  email: string,
  options: AuthLinkOptions = {},
): Promise<{ actionLink: string; userId: string | null }> {
  const client = sbAdmin;
  if (!client) {
    throw new Error("Supabase client not initialized");
  }

  const emailValue = requireValue(email, "email").toLowerCase();
  const redirectTo = options.redirectTo ?? INVITE_REDIRECT_URL;
  const type: AuthLinkType = options.type ?? "invite";

  const payload: Record<string, unknown> = {
    type,
    email: emailValue,
  };

  const optionsPayload: Record<string, unknown> = {};
  if (redirectTo && redirectTo.trim().length > 0) {
    optionsPayload.redirectTo = redirectTo.trim();
  }
  if (options.data && Object.keys(options.data).length > 0) {
    optionsPayload.data = options.data;
  }
  if (Object.keys(optionsPayload).length > 0) {
    payload.options = optionsPayload;
  }

  const { data, error } = await client.auth.admin.generateLink(payload as any);
  if (error) {
    throw error;
  }

  const actionLink = (data as any)?.properties?.action_link ?? (data as any)?.action_link ?? "";

  if (!actionLink) {
    throw new Error("Auth link was not returned by Supabase");
  }

  return { actionLink, userId: (data as any)?.user?.id ?? null };
}

export async function generateInviteLink(
  email: string,
  options: Omit<AuthLinkOptions, "type"> = {},
): Promise<{ actionLink: string; userId: string | null }> {
  return await generateAuthLink(email, { ...options, type: "invite" });
}

export async function generateMagicLink(
  email: string,
  options: Omit<AuthLinkOptions, "type"> = {},
): Promise<{ actionLink: string; userId: string | null }> {
  return await generateAuthLink(email, { ...options, type: "magiclink" });
}

export async function sendWelcomeEmail(
  to: string,
  fullName: string | null,
  actionLink: string,
  options: WelcomeEmailOptions = {},
): Promise<void> {
  const apiKey = requireValue(RESEND_API_KEY, "RESEND_API_KEY");
  const from = requireValue(options.from ?? RESEND_FROM, "RESEND_FROM");
  const recipient = requireValue(to, "to");
  const link = requireValue(actionLink, "actionLink");

  const safeName = fullName?.trim() ?? "";
  const nameSuffix = safeName ? `, ${escapeHtml(safeName)}` : "";
  const safeLink = escapeHtml(link);

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;">
      <h2>Welcome to ANKOR${nameSuffix}</h2>
      <p>Your account is ready. Click below to finish setup:</p>
      <p><a href="${safeLink}" style="display:inline-block;padding:12px 16px;background:#111;color:#fff;border-radius:10px;text-decoration:none">
        Finish setup
      </a></p>
      <p>If the button does not work, copy/paste this link:</p>
      <p>${safeLink}</p>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: recipient,
      subject: options.subject ?? "Welcome to ANKOR",
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend failed: ${res.status} ${body}`);
  }
}

export async function sendBulkEvaluationReportEmails(
  items: EvaluationReportEmailInput[],
  options: BulkEvaluationReportOptions = {},
): Promise<BulkEvaluationReportResult> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("items must be a non-empty array");
  }

  const apiKey = requireValue(RESEND_API_KEY, "RESEND_API_KEY");
  const defaultFrom = requireValue(RESEND_FROM, "RESEND_FROM");
  const defaultSubject = (options.subject ?? "New evaluation available").trim() || "New evaluation available";
  const defaultAppName = (options.appName ?? "ANKOR").trim() || "ANKOR";

  const results = await Promise.all(
    items.map(async (item) => {
      const toCandidate = typeof item?.to === "string" ? item.to.trim() : "";
      try {
        const payload = normalizeEvaluationReportPayload(item, {
          from: defaultFrom,
          subject: defaultSubject,
          appName: defaultAppName,
        });
        const { to, from, subject, ...templateData } = payload;
        const html = buildEvaluationReportEmailHtml(templateData);
        const text = buildEvaluationReportEmailText(templateData);

        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            from,
            to,
            subject,
            html,
            text,
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Resend failed: ${res.status} ${body}`);
        }

        return { ok: true, to };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, to: toCandidate || "(unknown)", error: message };
      }
    }),
  );

  const failed = results
    .filter((result) => !result.ok)
    .map((result) => ({
      to: result.to,
      error: result.error,
    }));

  return {
    sent: results.length - failed.length,
    failed,
  };
}

export async function inviteUserAndSendWelcome(params: {
  email: string;
  fullName?: string | null;
  redirectTo?: string;
  data?: Record<string, unknown>;
  from?: string;
  subject?: string;
}): Promise<{ actionLink: string; userId: string | null }> {
  const { email, fullName, redirectTo, data, from, subject } = params;
  const { actionLink, userId } = await generateInviteLink(email, {
    redirectTo,
    data,
  });
  await sendWelcomeEmail(email, fullName ?? null, actionLink, { from, subject });
  return { actionLink, userId };
}
