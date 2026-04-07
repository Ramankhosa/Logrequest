import nodemailer from "nodemailer";

type EmailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export function getBaseUrl() {
  const url =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.VERCEL_URL;

  if (!url) {
    throw new Error("NEXTAUTH_URL, NEXT_PUBLIC_APP_URL, APP_URL, or VERCEL_URL must be set");
  }

  const baseUrl = url.startsWith("http") ? url : `https://${url}`;
  return baseUrl.replace(/\/$/, "");
}

export async function sendAuthEmail(input: EmailInput) {
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_PORT ||
    !process.env.SMTP_FROM
  ) {
    console.log("Auth email fallback", {
      to: input.to,
      subject: input.subject,
      text: input.text,
    });

    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined,
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
}
