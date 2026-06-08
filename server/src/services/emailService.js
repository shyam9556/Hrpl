import nodemailer from "nodemailer";
import env from "../config/env.js";
import path from "path";
import { fileURLToPath } from "url";
import dns from "dns";

// Force Node.js to prioritize IPv4 over IPv6. 
// Prevents SMTP connection timeouts on networks with broken IPv6 routing.
dns.setDefaultResultOrder("ipv4first");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pre-define shared attachments (CID images) for all emails
const SHARED_ATTACHMENTS = [
  {
    filename: 'logo.png',
    path: path.resolve(__dirname, "../../../public/logo.png"),
    cid: 'company-logo' // Used as src="cid:company-logo" in HTML
  }
];

/**
 * Escapes HTML characters in a string to prevent XSS.
 * @param {string} str - The string to escape
 * @returns {string} The escaped string
 */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Email Service — Handles sending system emails.
 *
 * Uses Nodemailer with configurable SMTP.
 * Falls back to console logging if SMTP is not configured (development).
 */

let transporter = null;

// Only create transporter if SMTP is configured
if (env.smtp.isConfigured) {
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465, // true for SSL on 465, false for STARTTLS on 587
    auth: {
      user: env.smtp.user,
      pass: env.smtp.password,
    },
    tls: {
      // Allow self-signed certs in dev; enforce valid certs in prod
      rejectUnauthorized: env.isProd,
    },
    // Prevent SMTP hangs from blocking the whole request
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

/**
 * Verify SMTP connection at startup.
 * Call this from index.js after the server starts to catch misconfiguration early.
 * Does not throw — logs a clear warning instead so startup is not blocked.
 */
export async function verifySMTPConnection() {
  if (!transporter) {
    console.warn("[SMTP] Skipping connection check — SMTP not configured.");
    return false;
  }
  try {
    await transporter.verify();
    console.log("[✅ SMTP] Connection verified successfully.");
    return true;
  } catch (err) {
    console.error("❌ [SMTP] Connection verification failed:", err.message);
    console.error("   Check SMTP_HOST, SMTP_USER, SMTP_PASSWORD in server/.env");
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// SHARED TEMPLATE HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Wraps any email body content in the shared branded shell.
 * Uses a table-based layout so it renders correctly in Gmail, Outlook, Apple Mail, etc.
 *
 * @param {object} opts
 * @param {string} opts.subtitle   - Small label under company name in header (e.g. "Dealer Registration Update")
 * @param {string} opts.bodyHtml   - HTML string for the email body section
 * @returns {string} Complete HTML document
 */
function buildEmailHtml({ subtitle, bodyHtml }) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Highlight Pro</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f4f0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">

  <!--[if mso]><table width="100%" cellpadding="0" cellspacing="0"><tr><td><![endif]-->

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f0f4f0;padding:40px 16px;">
    <tr>
      <td align="center">

        <!-- Email card -->
        <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.10);">

          <!-- ─── Header ─── -->
          <tr>
            <td style="background:linear-gradient(135deg,#1C3A2A 0%,#2E7D52 100%);padding:36px 32px;text-align:center;">
              <!-- Inline CID attachment logo — embedded directly in the email -->
              <img src="cid:company-logo"
                   alt="Highlight Pro"
                   width="60" height="60"
                   style="display:block;margin:0 auto 16px auto;border-radius:12px;background-color:#ffffff;border:3px solid rgba(255,255,255,0.25);padding:4px;" />
              <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;letter-spacing:-0.3px;line-height:1.2;">
                Highlight Pro
              </h1>
              <p style="color:rgba(255,255,255,0.75);margin:6px 0 0 0;font-size:11px;text-transform:uppercase;letter-spacing:2px;font-weight:600;">
                ${subtitle}
              </p>
            </td>
          </tr>

          <!-- ─── Body ─── -->
          <tr>
            <td style="padding:36px 36px 28px 36px;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- ─── Divider ─── -->
          <tr>
            <td style="padding:0 36px;">
              <hr style="border:none;border-top:1px solid #e9ecef;margin:0;" />
            </td>
          </tr>

          <!-- ─── Footer ─── -->
          <tr>
            <td style="padding:20px 36px;text-align:center;">
              <p style="color:#9ca3af;font-size:12px;margin:0 0 4px 0;line-height:1.6;">
                This is an automated email from <strong style="color:#6b7280;">Highlight Pro</strong>. Please do not reply to this email.
              </p>
              <p style="color:#9ca3af;font-size:12px;margin:0;line-height:1.6;">
                &copy; ${year} Highlight Pro. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
        <!-- /Email card -->

      </td>
    </tr>
  </table>

  <!--[if mso]></td></tr></table><![endif]-->

</body>
</html>`;
}

/**
 * Renders a CTA button that is safe for all email clients.
 * Uses a table-based VML button for Outlook, with a regular <a> fallback.
 */
function ctaButton({ href, label, color = "#2E7D52", textColor = "#ffffff" }) {
  return `
<table cellpadding="0" cellspacing="0" border="0" style="margin:28px auto 0 auto;">
  <tr>
    <td align="center" style="border-radius:8px;background-color:${color};">
      <a href="${href}"
         target="_blank"
         style="display:inline-block;color:${textColor};text-decoration:none;font-size:15px;font-weight:600;padding:14px 36px;border-radius:8px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
        ${label}
      </a>
    </td>
  </tr>
</table>`;
}

/**
 * Renders a highlighted info box (for quotation number, security notes, etc.)
 */
function infoBox({ content, bgColor = "#f0f7f4", borderColor = "#2E7D52" }) {
  return `
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;">
  <tr>
    <td style="background-color:${bgColor};border-left:4px solid ${borderColor};border-radius:0 6px 6px 0;padding:14px 16px;font-size:14px;color:#374151;line-height:1.6;">
      ${content}
    </td>
  </tr>
</table>`;
}

// ─────────────────────────────────────────────────────────────
// PASSWORD RESET EMAIL
// ─────────────────────────────────────────────────────────────

/**
 * Send a password reset email with a reset link.
 *
 * @param {string} toEmail    - Recipient email address
 * @param {string} userName   - Recipient's name (for personalization)
 * @param {string} resetToken - The password reset token
 * @returns {boolean} true if sent successfully, false otherwise
 */
export async function sendPasswordResetEmail(toEmail, userName, resetToken) {
  const resetUrl = `${env.clientUrl}?token=${resetToken}`;

  const bodyHtml = [
    '<h2 style="color:#111827;margin:0 0 8px 0;font-size:22px;font-weight:700;line-height:1.3;">',
    '  Password Reset Request',
    '</h2>',
    '<p style="color:#6b7280;font-size:13px;margin:0 0 24px 0;">',
    '  Received on ', new Date().toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" }),
    '</p>',
    '<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 12px 0;">',
    '  Hello <strong>', escapeHtml(userName), '</strong>,',
    '</p>',
    '<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px 0;">',
    '  We received a request to reset the password for your Highlight Pro account.',
    '  Click the button below to set a new password.',
    '</p>',
    ctaButton({ href: resetUrl, label: "Reset My Password", color: "#2E7D52" }),
    infoBox({
      content: [
        '<strong style="display:block;margin-bottom:4px;color:#1f2937;">&#9888;&#65039; Security Notice</strong><br>',
        'This link is valid for <strong>1 hour</strong> and can only be used once.<br>',
        'If you did not request a password reset, please ignore this email &mdash; your account remains secure.'
      ].join(''),
      bgColor: "#fffbeb",
      borderColor: "#f59e0b",
    }),
    '<p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:20px 0 0 0;">',
    '  If the button above doesn\'t work, copy and paste the link below into your browser:<br>',
    '  <a href="', escapeHtml(resetUrl), '" style="color:#2E7D52;word-break:break-all;">', escapeHtml(resetUrl), '</a>',
    '</p>'
  ].join('');

  const htmlContent = buildEmailHtml({ subtitle: "Account Security", bodyHtml });

  // If SMTP is not configured, log to console (development mode)
  if (!transporter) {
    console.log("");
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║  📧 PASSWORD RESET EMAIL (Dev Mode — Not Sent)  ║");
    console.log("╠══════════════════════════════════════════════════╣");
    console.log(`║  To:    ${toEmail}`);
    console.log(`║  Name:  ${userName}`);
    console.log(`║  Link:  ${resetUrl}`);
    console.log(`║  Token: ${resetToken}`);
    console.log("╚══════════════════════════════════════════════════╝");
    console.log("");
    return true; // Pretend it was sent successfully in dev
  }

  try {
    await transporter.sendMail({
      from: `"${env.smtp.fromName}" <${env.smtp.fromEmail}>`,
      to: toEmail,
      subject: "Reset Your Password — Highlight Pro",
      html: htmlContent,
      attachments: SHARED_ATTACHMENTS,
    });
    console.log(`📧 Password reset email sent to: ${toEmail}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send password reset email to ${toEmail}:`, err.message);
    throw new Error("Failed to send password reset email. Please try again later.");
  }
}

// ─────────────────────────────────────────────────────────────
// DEALER REGISTRATION STATUS EMAIL
// ─────────────────────────────────────────────────────────────

/**
 * Send dealer registration status notification email.
 *
 * @param {string} toEmail     - Dealer's email
 * @param {string} dealerName  - Dealer's name
 * @param {"Approved"|"Rejected"} status - New status
 * @param {string|null} [reason] - Admin's rejection reason (shown in email, Rejected only)
 */
export async function sendDealerStatusEmail(toEmail, dealerName, status, reason = null) {
  const isApproved = status === "Approved";

  const statusBadge = isApproved
    ? `<span style="display:inline-block;background-color:#dcfce7;color:#166534;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:0.5px;text-transform:uppercase;">Approved</span>`
    : `<span style="display:inline-block;background-color:#fee2e2;color:#991b1b;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:0.5px;text-transform:uppercase;">Not Approved</span>`;

  const bodyHtml = isApproved ? `
    <p style="margin:0 0 16px 0;">${statusBadge}</p>

    <h2 style="color:#111827;margin:0 0 20px 0;font-size:22px;font-weight:700;line-height:1.3;">
      Welcome to Highlight Pro!
    </h2>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 12px 0;">
      Dear <strong>${escapeHtml(dealerName)}</strong>,
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 8px 0;">
      We are pleased to inform you that your dealer registration application has been
      <strong style="color:#166534;">approved</strong>. Your account is now active and ready to use.
    </p>

    ${infoBox({
      content: `
        <strong style="display:block;margin-bottom:6px;color:#1f2937;">You can now:</strong>
        &#10003;&nbsp; Log in to the Highlight Pro dealer portal<br>
        &#10003;&nbsp; Create and submit solar system quotations<br>
        &#10003;&nbsp; Track your quotation approval status<br>
        &#10003;&nbsp; Manage your customer pipeline
      `,
      bgColor: "#f0f7f4",
      borderColor: "#2E7D52",
    })}

    ${ctaButton({ href: env.clientUrl, label: "Log In to Your Account", color: "#2E7D52" })}

    <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:24px 0 0 0;">
      If you have any questions or need assistance, please contact our support team.
      We look forward to a successful partnership.
    </p>
  ` : `
    <p style="margin:0 0 16px 0;">${statusBadge}</p>

    <h2 style="color:#111827;margin:0 0 20px 0;font-size:22px;font-weight:700;line-height:1.3;">
      Application Status Update
    </h2>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 12px 0;">
      Dear <strong>${escapeHtml(dealerName)}</strong>,
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px 0;">
      Thank you for your interest in becoming a Highlight Pro dealer.
      After carefully reviewing your application, we regret to inform you that we are
      unable to approve your registration at this time.
    </p>

    ${reason ? infoBox({
      content: `
        <strong style="display:block;margin-bottom:6px;color:#1f2937;">Reason for Rejection:</strong>
        <span style="color:#374151;font-size:14px;line-height:1.6;">${escapeHtml(reason)}</span>
      `,
      bgColor: "#fef2f2",
      borderColor: "#dc2626",
    }) : ""}

    ${infoBox({
      content: [
        'If you believe this decision was made in error, or if you have updated your ',
        'credentials and would like to reapply, please reach out to our team at ',
        '<a href="mailto:', escapeHtml(env.smtp.fromEmail), '" style="color:#2E7D52;">', escapeHtml(env.smtp.fromEmail), '</a>. ',
        'We would be happy to guide you through the process.'
      ].join(''),
      bgColor: "#f9fafb",
      borderColor: "#6b7280",
    })}

    <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:24px 0 0 0;">
      We appreciate the time you took to apply and hope to work with you in the future.
    </p>
  `;

  const htmlContent = buildEmailHtml({
    subtitle: "Dealer Registration Update",
    bodyHtml,
  });

  if (!transporter) {
    console.log(`📧 [Dev] Dealer ${status} email for ${toEmail} (${dealerName}) — not sent (no SMTP)`);
    return true;
  }

  try {
    await transporter.sendMail({
      from: `"${env.smtp.fromName}" <${env.smtp.fromEmail}>`,
      to: toEmail,
      subject: isApproved
        ? "Your Highlight Pro Dealer Account Has Been Approved"
        : "Highlight Pro — Dealer Registration Update",
      html: htmlContent,
      attachments: SHARED_ATTACHMENTS,
    });
    console.log(`📧 Dealer ${status} email sent to: ${toEmail}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send dealer status email to ${toEmail}:`, err.message);
    // Don't throw — this is a notification, not critical
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// QUOTATION STATUS EMAIL
// ─────────────────────────────────────────────────────────────

/**
 * Send quotation status notification to the dealer.
 *
 * Called when admin Approves or Rejects a quotation so the dealer
 * knows without having to manually refresh the portal.
 *
 * @param {string} toEmail       - Dealer's email address
 * @param {string} dealerName    - Dealer's display name
 * @param {string} quotationNo   - Quotation number (e.g. HP/2025-26/0001)
 * @param {"Approved"|"Rejected"} status - New quotation status
 * @returns {boolean} true if sent (or dev mode), false on failure
 */
export async function sendQuotationStatusEmail(toEmail, dealerName, quotationNo, status) {
  const isApproved = status === "Approved";

  const statusBadge = isApproved
    ? `<span style="display:inline-block;background-color:#dcfce7;color:#166534;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:0.5px;text-transform:uppercase;">Approved</span>`
    : `<span style="display:inline-block;background-color:#fee2e2;color:#991b1b;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:0.5px;text-transform:uppercase;">Rejected</span>`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">${statusBadge}</p>

    <h2 style="color:#111827;margin:0 0 20px 0;font-size:22px;font-weight:700;line-height:1.3;">
      ${isApproved ? "Quotation Approved" : "Quotation Rejected"}
    </h2>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 12px 0;">
      Dear <strong>${escapeHtml(dealerName)}</strong>,
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 8px 0;">
      ${isApproved
        ? `We are pleased to inform you that your quotation has been <strong style="color:#166534;">approved</strong> by the admin team.`
        : `Your quotation has been <strong style="color:#991b1b;">rejected</strong> by the admin team.`
      }
    </p>

    ${infoBox({
      content: [
        '<strong style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Quotation Reference</strong><br>',
        '<span style="font-family:monospace;font-size:17px;font-weight:700;color:#111827;letter-spacing:0.5px;">', escapeHtml(quotationNo), '</span>'
      ].join(''),
      bgColor: "#f8fafc",
      borderColor: isApproved ? "#2E7D52" : "#dc2626",
    })}

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:16px 0 0 0;">
      ${isApproved
        ? `You can now proceed with the installation. Please log in to your dealer portal to track the project status and upload geo-tagged installation photos once the work is complete.`
        : `Please log in to your dealer portal to review the details, or contact our admin team for clarification before submitting a revised quotation.`
      }
    </p>

    ${ctaButton({
      href: env.clientUrl,
      label: "View in Portal",
      color: isApproved ? "#2E7D52" : "#374151",
    })}

    <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:24px 0 0 0;">
      If you have any questions regarding this update, please contact your Highlight Pro account manager.
    </p>
  `;

  const htmlContent = buildEmailHtml({
    subtitle: "Quotation Status Update",
    bodyHtml,
  });

  if (!transporter) {
    console.log(`📧 [Dev] Quotation ${status} email for ${toEmail} (${quotationNo}) — not sent (no SMTP)`);
    return true;
  }

  try {
    await transporter.sendMail({
      from: `"${env.smtp.fromName}" <${env.smtp.fromEmail}>`,
      to: toEmail,
      subject: isApproved
        ? `Quotation ${quotationNo} Approved — Highlight Pro`
        : `Quotation ${quotationNo} — Action Required`,
      html: htmlContent,
      attachments: SHARED_ATTACHMENTS,
    });
    console.log(`📧 Quotation ${status} email sent to: ${toEmail} for ${quotationNo}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send quotation status email to ${toEmail}:`, err.message);
    // Don't throw — email failure should not block the status update
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// DEALER WELCOME EMAIL (on new registration submission)
// ─────────────────────────────────────────────────────────────

/**
 * Send a welcome / application-received email to a newly registered dealer.
 * Called immediately after a dealer submits the registration form (before admin review).
 *
 * @param {string} toEmail    - Dealer's email address
 * @param {string} dealerName - Dealer's full name
 * @returns {boolean} true if sent (or dev mode), false on failure
 */
export async function sendDealerWelcomeEmail(toEmail, dealerName) {
  const bodyHtml = `
    <h2 style="color:#111827;margin:0 0 20px 0;font-size:22px;font-weight:700;line-height:1.3;">
      Application Received!
    </h2>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 12px 0;">
      Dear <strong>${escapeHtml(dealerName)}</strong>,
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px 0;">
      Thank you for applying to become a <strong>Highlight Pro</strong> dealer.
      We have received your registration application and our team will review it shortly.
    </p>

    ${infoBox({
      content: `
        <strong style="display:block;margin-bottom:6px;color:#1f2937;">What happens next?</strong>
        &#10003;&nbsp; Our admin team will review your submitted documents<br>
        &#10003;&nbsp; You will receive an email once a decision has been made<br>
        &#10003;&nbsp; Typical review time: <strong>1–3 working days</strong>
      `,
      bgColor: "#f0f7f4",
      borderColor: "#2E7D52",
    })}

    <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:24px 0 0 0;">
      If you have any questions in the meantime, feel free to reach out to us at
      <a href="mailto:${escapeHtml(env.smtp.fromEmail)}" style="color:#2E7D52;">${escapeHtml(env.smtp.fromEmail)}</a>.
      We look forward to welcoming you to the Highlight Pro dealer network.
    </p>
  `;

  const htmlContent = buildEmailHtml({
    subtitle: "Dealer Registration",
    bodyHtml,
  });

  if (!transporter) {
    console.log(`📧 [Dev] Welcome email for ${toEmail} (${dealerName}) — not sent (no SMTP)`);
    return true;
  }

  try {
    await transporter.sendMail({
      from: `"${env.smtp.fromName}" <${env.smtp.fromEmail}>`,
      to: toEmail,
      subject: "Application Received — Highlight Pro",
      html: htmlContent,
      attachments: SHARED_ATTACHMENTS,
    });
    console.log(`📧 Welcome email sent to: ${toEmail}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send welcome email to ${toEmail}:`, err.message);
    // Don't throw — welcome email failure must never block registration
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// DELIVERY MILESTONE EMAIL
// ─────────────────────────────────────────────────────────────

/**
 * Send a delivery milestone notification to the dealer when material
 * delivery status changes to "Dispatched" or "Delivered".
 *
 * @param {string} toEmail        - Dealer's email address
 * @param {string} dealerName     - Dealer's display name
 * @param {string} quotationNo    - Quotation number (e.g. HP/2025-26/0001)
 * @param {string} customerName   - Customer's name (or "N/A" if no customer linked)
 * @param {"Dispatched"|"Delivered"} deliveryStatus - The new delivery status
 * @returns {boolean} true if sent (or dev mode), false on failure
 */
export async function sendDeliveryMilestoneEmail(toEmail, dealerName, quotationNo, customerName, deliveryStatus) {
  const isDispatched = deliveryStatus === "Dispatched";

  const statusBadge = isDispatched
    ? `<span style="display:inline-block;background-color:#dbeafe;color:#1e40af;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:0.5px;text-transform:uppercase;">Dispatched</span>`
    : `<span style="display:inline-block;background-color:#dcfce7;color:#166534;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:0.5px;text-transform:uppercase;">Delivered</span>`;

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">${statusBadge}</p>

    <h2 style="color:#111827;margin:0 0 20px 0;font-size:22px;font-weight:700;line-height:1.3;">
      ${isDispatched ? "Materials Dispatched!" : "Materials Delivered!"}
    </h2>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 12px 0;">
      Dear <strong>${escapeHtml(dealerName)}</strong>,
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px 0;">
      ${isDispatched
        ? `Great news! The solar materials for the following quotation have been <strong style="color:#1e40af;">dispatched</strong> and are on their way.`
        : `The solar materials for the following quotation have been <strong style="color:#166534;">delivered</strong> successfully.`
      }
    </p>

    ${infoBox({
      content: [
        '<strong style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Quotation Reference</strong><br>',
        `<span style="font-family:monospace;font-size:17px;font-weight:700;color:#111827;letter-spacing:0.5px;">${escapeHtml(quotationNo)}</span>`,
        customerName && customerName !== "N/A"
          ? `<br><span style="font-size:13px;color:#6b7280;margin-top:4px;display:block;">Customer: <strong style="color:#374151;">${escapeHtml(customerName)}</strong></span>`
          : "",
      ].join(""),
      bgColor: "#f8fafc",
      borderColor: isDispatched ? "#3b82f6" : "#2E7D52",
    })}

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:16px 0 0 0;">
      ${isDispatched
        ? `Please coordinate with the customer to ensure someone is available to receive the delivery. Log in to your dealer portal to track the latest status.`
        : `Please proceed with the installation at the customer's site. Once the installation is complete, remember to upload <strong>geo-tagged installation photos</strong> through your dealer portal.`
      }
    </p>

    ${ctaButton({
      href: env.clientUrl,
      label: "View in Portal",
      color: isDispatched ? "#2563eb" : "#2E7D52",
    })}

    <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:24px 0 0 0;">
      If you have any questions, please contact your Highlight Pro account manager.
    </p>
  `;

  const htmlContent = buildEmailHtml({
    subtitle: `Delivery ${deliveryStatus}`,
    bodyHtml,
  });

  if (!transporter) {
    console.log(`📧 [Dev] Delivery ${deliveryStatus} email for ${toEmail} (${quotationNo}) — not sent (no SMTP)`);
    return true;
  }

  try {
    await transporter.sendMail({
      from: `"${env.smtp.fromName}" <${env.smtp.fromEmail}>`,
      to: toEmail,
      subject: isDispatched
        ? `Materials Dispatched for ${quotationNo} — Highlight Pro`
        : `Materials Delivered for ${quotationNo} — Highlight Pro`,
      html: htmlContent,
      attachments: SHARED_ATTACHMENTS,
    });
    console.log(`📧 Delivery ${deliveryStatus} email sent to: ${toEmail} for ${quotationNo}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send delivery milestone email to ${toEmail}:`, err.message);
    // Don't throw — email failure should not block the delivery status update
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// DOCUMENT RE-UPLOAD REQUEST EMAIL
// ─────────────────────────────────────────────────────────────

/**
 * Send a document re-upload request email to a dealer whose registration was rejected.
 * Contains a secure link for the dealer to authenticate and re-upload the flagged documents.
 *
 * @param {string} toEmail      - Dealer's email address
 * @param {string} dealerName   - Dealer's full name
 * @param {string} reuploadUrl  - Full re-upload link (CLIENT_URL?reupload=<raw_token>)
 * @param {string} reason       - Admin's reason for requesting re-upload
 * @param {string[]} docTypes   - Array of doc type keys that need re-uploading e.g. ['aadhaar','pan']
 * @returns {boolean} true if sent (or dev mode), false on failure
 */
export async function sendDocumentReuploadEmail(toEmail, dealerName, reuploadUrl, reason, docTypes = []) {
  // Human-readable document names
  const docLabels = {
    aadhaar:       "Aadhaar Card",
    aadhaar_front: "Aadhaar Card (Front Side)",
    aadhaar_back:  "Aadhaar Card (Back Side)",
    pan:           "PAN Card",
    passport_photo: "Passport Photo",
    other:         "Dealership Agreement",
  };

  const docListHtml = docTypes.length > 0
    ? docTypes.map(d => `&#10007;&nbsp; <strong>${docLabels[d] || d}</strong>`).join("<br>")
    : "All submitted documents";

  const bodyHtml = `
    <span style="display:inline-block;background-color:#fff3cd;color:#856404;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:16px;">Action Required</span>

    <h2 style="color:#111827;margin:0 0 20px 0;font-size:22px;font-weight:700;line-height:1.3;">
      Document Re-upload Required
    </h2>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 12px 0;">
      Dear <strong>${escapeHtml(dealerName)}</strong>,
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px 0;">
      Our admin team has reviewed your dealer registration application and found that one or more of
      your submitted documents need to be re-uploaded. Please use the secure link below to submit
      updated documents.
    </p>

    ${infoBox({
      content: `
        <strong style="display:block;margin-bottom:6px;color:#1f2937;">Admin's Note:</strong>
        <span style="color:#374151;font-size:14px;line-height:1.6;">${escapeHtml(reason)}</span>
      `,
      bgColor: "#fff8e6",
      borderColor: "#f59e0b",
    })}

    ${infoBox({
      content: `
        <strong style="display:block;margin-bottom:8px;color:#1f2937;">Documents to Re-upload:</strong>
        <span style="font-size:14px;line-height:1.8;color:#374151;">${docListHtml}</span>
      `,
      bgColor: "#fef2f2",
      borderColor: "#dc2626",
    })}

    ${ctaButton({ href: reuploadUrl, label: "Re-upload Documents", color: "#2E7D52" })}

    ${infoBox({
      content: [
        '<strong style="display:block;margin-bottom:4px;color:#1f2937;">&#9888;&#65039; Important</strong>',
        'This link is valid for <strong>3 days</strong> and can only be used once.<br>',
        'You will need to enter the <strong>password you used during registration</strong> to access the re-upload page.'
      ].join(''),
      bgColor: "#fffbeb",
      borderColor: "#f59e0b",
    })}

    <p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:20px 0 0 0;">
      If the button above doesn't work, copy and paste the link below into your browser:<br>
      <a href="${escapeHtml(reuploadUrl)}" style="color:#2E7D52;word-break:break-all;">${escapeHtml(reuploadUrl)}</a>
    </p>
  `;

  const htmlContent = buildEmailHtml({ subtitle: "Document Re-upload Request", bodyHtml });

  if (!transporter) {
    console.log("");
    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║  📧 REUPLOAD REQUEST EMAIL (Dev Mode — Not Sent)   ║");
    console.log("╠══════════════════════════════════════════════════════╣");
    console.log(`║  To:     ${toEmail}`);
    console.log(`║  Name:   ${dealerName}`);
    console.log(`║  Reason: ${reason}`);
    console.log(`║  Docs:   ${docTypes.join(", ")}`);
    console.log(`║  Link:   ${reuploadUrl}`);
    console.log("╚══════════════════════════════════════════════════════╝");
    console.log("");
    return true;
  }

  try {
    await transporter.sendMail({
      from: `"${env.smtp.fromName}" <${env.smtp.fromEmail}>`,
      to: toEmail,
      subject: "Action Required: Re-upload Documents — Highlight Pro",
      html: htmlContent,
      attachments: SHARED_ATTACHMENTS,
    });
    console.log(`📧 Re-upload request email sent to: ${toEmail}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send re-upload request email to ${toEmail}:`, err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// REUPLOAD CONFIRMATION EMAIL (sent after dealer re-uploads docs)
// ─────────────────────────────────────────────────────────────

/**
 * Send a confirmation email to the dealer after they successfully re-upload their documents.
 * Informs them their application is back under review.
 *
 * @param {string} toEmail    - Dealer's email address
 * @param {string} dealerName - Dealer's full name
 * @returns {boolean} true if sent (or dev mode), false on failure
 */
export async function sendReuploadConfirmationEmail(toEmail, dealerName) {
  const bodyHtml = `
    <span style="display:inline-block;background-color:#dbeafe;color:#1e40af;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:16px;">Under Review</span>

    <h2 style="color:#111827;margin:0 0 20px 0;font-size:22px;font-weight:700;line-height:1.3;">
      Documents Received — Application Under Review
    </h2>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 12px 0;">
      Dear <strong>${escapeHtml(dealerName)}</strong>,
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px 0;">
      Thank you for re-uploading your documents. We have successfully received your updated
      documents and your <strong>registration application is now back under review</strong> by our admin team.
    </p>

    ${infoBox({
      content: `
        <strong style="display:block;margin-bottom:6px;color:#1f2937;">What happens next?</strong>
        &#10003;&nbsp; Our admin team will review your updated documents<br>
        &#10003;&nbsp; You will receive an email once a decision has been made<br>
        &#10003;&nbsp; Typical review time: <strong>1–3 working days</strong>
      `,
      bgColor: "#f0f7f4",
      borderColor: "#2E7D52",
    })}

    <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:24px 0 0 0;">
      If you have any questions in the meantime, feel free to reach out to us at
      <a href="mailto:${escapeHtml(env.smtp.fromEmail)}" style="color:#2E7D52;">${escapeHtml(env.smtp.fromEmail)}</a>.
    </p>
  `;

  const htmlContent = buildEmailHtml({ subtitle: "Application Status Update", bodyHtml });

  if (!transporter) {
    console.log(`📧 [Dev] Re-upload confirmation email for ${toEmail} (${dealerName}) — not sent (no SMTP)`);
    return true;
  }

  try {
    await transporter.sendMail({
      from: `"${env.smtp.fromName}" <${env.smtp.fromEmail}>`,
      to: toEmail,
      subject: "Documents Received — Application Under Review — Highlight Pro",
      html: htmlContent,
      attachments: SHARED_ATTACHMENTS,
    });
    console.log(`📧 Re-upload confirmation email sent to: ${toEmail}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send re-upload confirmation email to ${toEmail}:`, err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// QUOTATION DOCUMENT & GEOTAG RE-UPLOAD REQUEST EMAIL
// ─────────────────────────────────────────────────────────────

/**
 * Send a document/geotag re-upload request email to a dealer for a customer's quotation.
 * Contains a secure link for the dealer to authenticate and re-upload the flagged files.
 */
export async function sendQuotationReuploadEmail(toEmail, dealerName, customerName, quotationNo, reuploadUrl, reason, docTypes = []) {
  const docLabels = {
    aadhaar: "Aadhaar Card",
    pan: "PAN Card",
    passport_photo: "Passport Photo",
    other: "Dealership Agreement",
    passbook: "Bank Passbook",
    light_bill: "Latest Light Bill",
    vera_bill: "Vera Bill",
    house_photo_1: "House Photo 1",
    house_photo_2: "House Photo 2",
    house_photo_3: "House Photo 3",
    geotag_1: "Site / Inverter Photo (Geotagged)",
    geotag_2: "Solar Panels Photo (Geotagged)",
    geotag_3: "ACDB / Net Meter Photo (Geotagged)",
  };

  const docListHtml = docTypes.length > 0
    ? docTypes.map(d => `&#10007;&nbsp; <strong>${docLabels[d] || d}</strong>`).join("<br>")
    : "All customer documents / geotag photos";

  const bodyHtml = `
    <span style="display:inline-block;background-color:#fff3cd;color:#856404;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:16px;">Action Required</span>

    <h2 style="color:#111827;margin:0 0 20px 0;font-size:22px;font-weight:700;line-height:1.3;">
      Quotation Documents/Geotag Re-upload Required
    </h2>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 12px 0;">
      Dear <strong>${escapeHtml(dealerName)}</strong>,
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px 0;">
      Our admin team has reviewed the documents submitted for customer <strong>${escapeHtml(customerName)}</strong> (Quotation: <strong>${escapeHtml(quotationNo)}</strong>) and found that some files or geotags need to be replaced. Please use the secure link below to re-upload them.
    </p>

    ${infoBox({
      content: `
        <strong style="display:block;margin-bottom:6px;color:#1f2937;">Admin's Note:</strong>
        <span style="color:#374151;font-size:14px;line-height:1.6;">${escapeHtml(reason)}</span>
      `,
      bgColor: "#fff8e6",
      borderColor: "#f59e0b",
    })}

    ${infoBox({
      content: `
        <strong style="display:block;margin-bottom:8px;color:#1f2937;">Required Replacements:</strong>
        <span style="font-size:14px;line-height:1.8;color:#374151;">${docListHtml}</span>
      `,
      bgColor: "#fef2f2",
      borderColor: "#dc2626",
    })}

    ${ctaButton({ href: reuploadUrl, label: "Re-upload Files", color: "#2E7D52" })}

    ${infoBox({
      content: [
        '<strong style="display:block;margin-bottom:4px;color:#1f2937;">&#9888;&#65039; Important</strong>',
        'This secure link is valid for <strong>3 days</strong> (72 hours) and can only be used once.<br>',
        'You will need to verify your identity with your <strong>dealer portal password</strong> to proceed.'
      ].join(''),
      bgColor: "#fffbeb",
      borderColor: "#f59e0b",
    })}

    <p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:20px 0 0 0;">
      If the button above doesn't work, copy and paste the link below into your browser:<br>
      <a href="${escapeHtml(reuploadUrl)}" style="color:#2E7D52;word-break:break-all;">${escapeHtml(reuploadUrl)}</a>
    </p>
  `;

  const htmlContent = buildEmailHtml({ subtitle: "Quotation Document Re-upload", bodyHtml });

  if (!transporter) {
    console.log("");
    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║  📧 QUOTATION REUPLOAD REQUEST (Dev Mode — Not Sent) ║");
    console.log("╠══════════════════════════════════════════════════════╣");
    console.log(`║  To:       ${toEmail}`);
    console.log(`║  Name:     ${dealerName}`);
    console.log(`║  Customer: ${customerName}`);
    console.log(`║  Quote:    ${quotationNo}`);
    console.log(`║  Reason:   ${reason}`);
    console.log(`║  Files:    ${docTypes.join(", ")}`);
    console.log(`║  Link:     ${reuploadUrl}`);
    console.log("╚══════════════════════════════════════════════════════╝");
    console.log("");
    return true;
  }

  try {
    await transporter.sendMail({
      from: `"${env.smtp.fromName}" <${env.smtp.fromEmail}>`,
      to: toEmail,
      subject: `Action Required: Re-upload documents for ${customerName} — Highlight Pro`,
      html: htmlContent,
      attachments: SHARED_ATTACHMENTS,
    });
    console.log(`📧 Quotation re-upload request email sent to: ${toEmail}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send quotation re-upload request email to ${toEmail}:`, err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// QUOTATION REUPLOAD CONFIRMATION EMAIL (after submission)
// ─────────────────────────────────────────────────────────────

/**
 * Send a confirmation email to the dealer after they successfully re-upload quotation files.
 */
export async function sendQuotationReuploadConfirmationEmail(toEmail, dealerName, customerName, quotationNo) {
  const bodyHtml = `
    <span style="display:inline-block;background-color:#dbeafe;color:#1e40af;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:16px;">Under Review</span>

    <h2 style="color:#111827;margin:0 0 20px 0;font-size:22px;font-weight:700;line-height:1.3;">
      Files Received — Quotation Under Re-review
    </h2>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 12px 0;">
      Dear <strong>${escapeHtml(dealerName)}</strong>,
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px 0;">
      Thank you for re-uploading the requested documents for customer <strong>${escapeHtml(customerName)}</strong>. We have successfully received your updated files for Quotation <strong>${escapeHtml(quotationNo)}</strong>, and the quotation is now back under review by our admin team.
    </p>

    ${infoBox({
      content: `
        <strong style="display:block;margin-bottom:6px;color:#1f2937;">What happens next?</strong>
        &#10003;&nbsp; Our admin team will re-review the newly uploaded files/geotags<br>
        &#10003;&nbsp; You will receive an email once the quotation status changes<br>
        &#10003;&nbsp; Review time: <strong>1–2 working days</strong>
      `,
      bgColor: "#f0f7f4",
      borderColor: "#2E7D52",
    })}

    <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:24px 0 0 0;">
      If you have any questions in the meantime, feel free to reach out to us at
      <a href="mailto:${escapeHtml(env.smtp.fromEmail)}" style="color:#2E7D52;">${escapeHtml(env.smtp.fromEmail)}</a>.
    </p>
  `;

  const htmlContent = buildEmailHtml({ subtitle: "Quotation Status Update", bodyHtml });

  if (!transporter) {
    console.log(`📧 [Dev] Quotation re-upload confirmation email for ${toEmail} (${quotationNo}) — not sent (no SMTP)`);
    return true;
  }

  try {
    await transporter.sendMail({
      from: `"${env.smtp.fromName}" <${env.smtp.fromEmail}>`,
      to: toEmail,
      subject: `Documents Received: Quotation ${quotationNo} Under Review — Highlight Pro`,
      html: htmlContent,
      attachments: SHARED_ATTACHMENTS,
    });
    console.log(`📧 Quotation re-upload confirmation email sent to: ${toEmail}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send quotation re-upload confirmation email to ${toEmail}:`, err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// PORTAL DOCUMENT RE-UPLOAD NOTIFICATION EMAIL

/**
 * Notify a dealer to log into the portal and re-upload specific quotation documents.
 * No secure link — dealer is already registered and can log in directly.
 *
 * @param {string} toEmail        - Dealer's email address
 * @param {string} dealerName     - Dealer's display name
 * @param {string} customerName   - Customer's name
 * @param {string} quotationNo    - Quotation number
 * @param {string} reason         - Admin's reason for requesting re-upload
 * @param {string[]} docTypes     - Array of doc type keys that need re-uploading
 * @returns {boolean} true if sent (or dev mode), false on failure
 */
export async function sendPortalReuploadNotificationEmail(toEmail, dealerName, customerName, quotationNo, reason, docTypes = []) {
  const docLabels = {
    aadhaar: "Aadhaar Card",
    pan: "PAN Card",
    passport_photo: "Passport Photo",
    other: "Dealership Agreement",
    passbook: "Bank Passbook",
    light_bill: "Latest Light Bill",
    vera_bill: "Vera Bill",
    house_photo_1: "House Photo 1",
    house_photo_2: "House Photo 2",
    house_photo_3: "House Photo 3",
    geotag_1: "Site / Inverter Photo (Geotagged)",
    geotag_2: "Solar Panels Photo (Geotagged)",
    geotag_3: "ACDB / Net Meter Photo (Geotagged)",
  };

  const docListHtml = docTypes.length > 0
    ? docTypes.map(d => `&#10007;&nbsp; <strong>${docLabels[d] || d}</strong>`).join("<br>")
    : "All customer documents";

  const bodyHtml = `
    <span style="display:inline-block;background-color:#fff3cd;color:#856404;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:16px;">Action Required</span>

    <h2 style="color:#111827;margin:0 0 20px 0;font-size:22px;font-weight:700;line-height:1.3;">
      Document Re-upload Required
    </h2>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 12px 0;">
      Dear <strong>${escapeHtml(dealerName)}</strong>,
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px 0;">
      Our admin team has reviewed the documents for customer <strong>${escapeHtml(customerName)}</strong>
      (Quotation: <strong>${escapeHtml(quotationNo)}</strong>) and found that some documents need to be
      re-uploaded. Please log in to your dealer portal and use the <strong>"Re-upload Documents"</strong>
      button on the relevant quotation row.
    </p>

    ${infoBox({
      content: `
        <strong style="display:block;margin-bottom:6px;color:#1f2937;">Admin's Note:</strong>
        <span style="color:#374151;font-size:14px;line-height:1.6;">${escapeHtml(reason)}</span>
      `,
      bgColor: "#fff8e6",
      borderColor: "#f59e0b",
    })}

    ${infoBox({
      content: `
        <strong style="display:block;margin-bottom:8px;color:#1f2937;">Documents to Re-upload:</strong>
        <span style="font-size:14px;line-height:1.8;color:#374151;">${docListHtml}</span>
      `,
      bgColor: "#fef2f2",
      borderColor: "#dc2626",
    })}

    ${ctaButton({ href: env.clientUrl, label: "Log In to Your Portal", color: "#2E7D52" })}

    ${infoBox({
      content: [
        '<strong style="display:block;margin-bottom:4px;color:#1f2937;">How to re-upload:</strong>',
        '1.&nbsp; Log in to your dealer portal.<br>',
        '2.&nbsp; Go to <strong>My Requests</strong>.<br>',
        '3.&nbsp; Find this quotation and click <strong>"Re-upload Documents"</strong>.<br>',
        '4.&nbsp; Upload the required files and submit.'
      ].join(''),
      bgColor: "#f0f7f4",
      borderColor: "#2E7D52",
    })}

    <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:24px 0 0 0;">
      If you have any questions, please contact your Highlight Pro account manager.
    </p>
  `;

  const htmlContent = buildEmailHtml({ subtitle: "Document Re-upload Request", bodyHtml });

  if (!transporter) {
    console.log("");
    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║  📧 PORTAL REUPLOAD NOTIFICATION (Dev Mode — Not Sent) ║");
    console.log("╠══════════════════════════════════════════════════════╣");
    console.log(`║  To:       ${toEmail}`);
    console.log(`║  Name:     ${dealerName}`);
    console.log(`║  Customer: ${customerName}`);
    console.log(`║  Quote:    ${quotationNo}`);
    console.log(`║  Reason:   ${reason}`);
    console.log(`║  Docs:     ${docTypes.join(", ")}`);
    console.log("╚══════════════════════════════════════════════════════╝");
    console.log("");
    return true;
  }

  try {
    await transporter.sendMail({
      from: `"${env.smtp.fromName}" <${env.smtp.fromEmail}>`,
      to: toEmail,
      subject: `Action Required: Re-upload Documents for ${customerName} — Highlight Pro`,
      html: htmlContent,
      attachments: SHARED_ATTACHMENTS,
    });
    console.log(`📧 Portal re-upload notification sent to: ${toEmail}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send portal re-upload notification to ${toEmail}:`, err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// GEO-TAG RE-UPLOAD NOTIFICATION EMAIL
// ─────────────────────────────────────────────────────────────

/**
 * Notify a dealer to log into the portal and re-upload geo-tag photos.
 * Only sent after a quotation is Approved. Dealer re-uploads via portal geo-tag modal.
 *
 * @param {string} toEmail      - Dealer's email address
 * @param {string} dealerName   - Dealer's display name
 * @param {string} quotationNo  - Quotation number
 * @param {string} reason       - Admin's reason for requesting geo-tag re-upload
 * @returns {boolean} true if sent (or dev mode), false on failure
 */
export async function sendGeotagReuploadEmail(toEmail, dealerName, quotationNo, reason) {
  const bodyHtml = `
    <span style="display:inline-block;background-color:#fff3cd;color:#856404;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:16px;">Action Required</span>

    <h2 style="color:#111827;margin:0 0 20px 0;font-size:22px;font-weight:700;line-height:1.3;">
      Geo-Tag Photos Re-upload Required
    </h2>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 12px 0;">
      Dear <strong>${escapeHtml(dealerName)}</strong>,
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px 0;">
      Our admin team has reviewed the geo-tagged installation photos for quotation
      <strong>${escapeHtml(quotationNo)}</strong> and found that one or more photos need to be
      re-uploaded. Please log in to your dealer portal, find this quotation in
      <strong>My Requests</strong>, and click the <strong>Geo-Tags</strong> button to upload new photos.
    </p>

    ${infoBox({
      content: `
        <strong style="display:block;margin-bottom:6px;color:#1f2937;">Admin's Note:</strong>
        <span style="color:#374151;font-size:14px;line-height:1.6;">${escapeHtml(reason)}</span>
      `,
      bgColor: "#fff8e6",
      borderColor: "#f59e0b",
    })}

    ${infoBox({
      content: `
        <strong style="display:block;margin-bottom:8px;color:#1f2937;">Required Photos:</strong>
        <span style="font-size:14px;line-height:1.8;color:#374151;">
          &#10007;&nbsp; <strong>Site / Inverter Photo</strong> (Geotagged)<br>
          &#10007;&nbsp; <strong>Solar Panels Photo</strong> (Geotagged)<br>
          &#10007;&nbsp; <strong>ACDB / Net Meter Photo</strong> (Geotagged)
        </span>
      `,
      bgColor: "#fef2f2",
      borderColor: "#dc2626",
    })}

    ${ctaButton({ href: env.clientUrl, label: "Log In to Upload Photos", color: "#2E7D52" })}

    ${infoBox({
      content: [
        '<strong style="display:block;margin-bottom:4px;color:#1f2937;">&#128247; How to re-upload geo-tags:</strong>',
        '1.&nbsp; Log in to your dealer portal.<br>',
        '2.&nbsp; Go to <strong>My Requests</strong>.<br>',
        '3.&nbsp; Find quotation <strong>', escapeHtml(quotationNo), '</strong>.<br>',
        '4.&nbsp; Click the <strong>Geo-Tags</strong> button and upload new photos with GPS enabled.'
      ].join(''),
      bgColor: "#f0f7f4",
      borderColor: "#2E7D52",
    })}

    <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:24px 0 0 0;">
      Please ensure your phone's location/GPS is enabled when taking these photos so that coordinates
      are embedded in the image. If you have any questions, contact your Highlight Pro account manager.
    </p>
  `;

  const htmlContent = buildEmailHtml({ subtitle: "Geo-Tag Re-upload Request", bodyHtml });

  if (!transporter) {
    console.log("");
    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║  📧 GEOTAG REUPLOAD EMAIL (Dev Mode — Not Sent)      ║");
    console.log("╠══════════════════════════════════════════════════════╣");
    console.log(`║  To:     ${toEmail}`);
    console.log(`║  Name:   ${dealerName}`);
    console.log(`║  Quote:  ${quotationNo}`);
    console.log(`║  Reason: ${reason}`);
    console.log("╚══════════════════════════════════════════════════════╝");
    console.log("");
    return true;
  }

  try {
    await transporter.sendMail({
      from: `"${env.smtp.fromName}" <${env.smtp.fromEmail}>`,
      to: toEmail,
      subject: `Action Required: Re-upload Geo-Tag Photos for ${quotationNo} — Highlight Pro`,
      html: htmlContent,
      attachments: SHARED_ATTACHMENTS,
    });
    console.log(`📧 Geo-tag re-upload email sent to: ${toEmail} for ${quotationNo}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send geo-tag re-upload email to ${toEmail}:`, err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// ADMIN PASSWORD RESET NOTIFICATION EMAIL
// ─────────────────────────────────────────────────────────────

/**
 * Send a password-reset notification email to a dealer when an admin has
 * force-reset their account password.
 *
 * SECURITY: We NEVER send the new password in plaintext via email.
 * Email is not encrypted end-to-end and may be logged by SMTP relays.
 * Instead, we email a secure reset link so the dealer sets their own password.
 *
 * @param {string} toEmail      - Dealer's email address
 * @param {string} dealerName   - Dealer's full name
 * @param {string} resetToken   - The raw (un-hashed) password reset token
 * @returns {boolean} true if sent (or dev mode), false on failure
 */
export async function sendAdminPasswordResetEmail(toEmail, dealerName, resetToken) {
  const resetUrl = `${env.clientUrl}?token=${resetToken}`;
  const changedAt = new Date().toLocaleString("en-IN", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });

  const bodyHtml = `
    <span style="display:inline-block;background-color:#fff3cd;color:#856404;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:16px;">Security Notice</span>

    <h2 style="color:#111827;margin:0 0 20px 0;font-size:22px;font-weight:700;line-height:1.3;">
      Your Account Password Has Been Reset
    </h2>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 12px 0;">
      Dear <strong>${escapeHtml(dealerName)}</strong>,
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px 0;">
      This is to inform you that an administrator at <strong>Highlight Pro</strong> has
      reset the password for your dealer account on <strong>${escapeHtml(changedAt)} (IST)</strong>.
      For your security, you must set a new password using the link below before you can log in.
    </p>

    ${ctaButton({ href: resetUrl, label: "Set New Password", color: "#2E7D52" })}

    ${infoBox({
      content: [
        '<strong style="display:block;margin-bottom:4px;color:#1f2937;">&#9888;&#65039; Important</strong>',
        'This link is valid for <strong>24 hours</strong> and can only be used once.<br>',
        'After clicking the button, you can choose any new password you like.',
      ].join(''),
      bgColor: "#fffbeb",
      borderColor: "#f59e0b",
    })}

    <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:24px 0 0 0;">
      If you did <strong style="color:#374151;">not</strong> expect this, or if this was done
      in error, please contact us immediately at
      <a href="mailto:${escapeHtml(env.smtp.fromEmail)}" style="color:#2E7D52;">${escapeHtml(env.smtp.fromEmail)}</a>
      so we can secure your account.
    </p>
    <p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:12px 0 0 0;">
      If the button above doesn't work, copy and paste this link into your browser:<br>
      <a href="${escapeHtml(resetUrl)}" style="color:#2E7D52;word-break:break-all;">${escapeHtml(resetUrl)}</a>
    </p>
  `;


  const htmlContent = buildEmailHtml({
    subtitle: "Account Security",
    bodyHtml,
  });

  if (!transporter) {
    console.log("");
    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║  📧 ADMIN PASSWORD RESET EMAIL (Dev Mode — Not Sent) ║");
    console.log("╠══════════════════════════════════════════════════════╣");
    console.log(`║  To:         ${toEmail}`);
    console.log(`║  Name:       ${dealerName}`);
    console.log(`║  Reset Link: ${resetUrl}`);
    console.log("╚══════════════════════════════════════════════════════╝");
    console.log("");
    return true;
  }

  try {
    await transporter.sendMail({
      from: `"${env.smtp.fromName}" <${env.smtp.fromEmail}>`,
      to: toEmail,
    subject: "Action Required: Set New Password — Highlight Pro",
      html: htmlContent,
      attachments: SHARED_ATTACHMENTS,
    });
    console.log(`📧 Admin password reset notification sent to: ${toEmail}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send admin password reset email to ${toEmail}:`, err.message);
    // Don't throw — email failure should not block the password reset action
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// EMAIL OTP VERIFICATION
// ─────────────────────────────────────────────────────────────

/**
 * Send a 6-digit OTP email for dealer registration email verification.
 *
 * Security notes:
 * - The OTP is displayed plaintext in the email — this is intentional and standard.
 * - The OTP stored in the DB is a SHA-256 hash (never plaintext on the server).
 * - Valid for 10 minutes. Max 5 wrong attempts before it locks.
 *
 * @param {string} toEmail  - Recipient email address
 * @param {string} otp      - The 6-digit plaintext OTP to display in the email
 * @returns {boolean} true if sent (or dev mode), false on failure
 */
export async function sendEmailOTPEmail(toEmail, otp) {
  // Render each digit as an individual table cell — avoids letter-spacing
  // rendering inconsistencies in Gmail Mobile and Apple Mail.
  const digitCells = otp.split("").map(d =>
    `<td style="width:36px;height:44px;text-align:center;vertical-align:middle;
                background:#ffffff;border:2px solid #2E7D52;border-radius:8px;
                font-size:24px;font-weight:800;color:#1C3A2A;
                font-family:'Courier New',Courier,monospace;padding:0;">` + escapeHtml(d) + `</td>
     <td style="width:6px;"></td>`
  ).join("");

  const bodyHtml = `
    <h2 style="color:#111827;margin:0 0 6px 0;font-size:20px;font-weight:700;line-height:1.3;">
      Verify Your Email Address
    </h2>
    <p style="color:#6b7280;font-size:12px;margin:0 0 20px 0;">
      ${new Date().toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" })}
    </p>

    <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 20px 0;">
      Use the verification code below to confirm your email address for your
      <strong>Highlight Pro</strong> dealer registration.
    </p>

    <!-- OTP Box: individual digit cells for reliable mobile rendering -->
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px 0;">
      <tr>
        <td align="center"
            style="background:#f0f7f4;border:1px solid #c6dfd2;border-radius:12px;padding:20px 16px;">
          <p style="margin:0 0 12px 0;font-size:10px;font-weight:700;letter-spacing:2px;
                     text-transform:uppercase;color:#6b7280;">
            Your Verification Code
          </p>
          <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
            <tr>${digitCells}</tr>
          </table>
        </td>
      </tr>
    </table>

    ${infoBox({
      content: [
        '<strong style="display:block;margin-bottom:4px;color:#1f2937;font-size:13px;">Code expires in 10 minutes</strong>',
        '<span style="color:#374151;font-size:13px;">Enter it on the registration page before it expires. If it expires, request a new one.</span>'
      ].join(''),
      bgColor: "#fffbeb",
      borderColor: "#f59e0b",
    })}

    ${infoBox({
      content: [
        '<strong style="display:block;margin-bottom:4px;color:#1f2937;font-size:13px;">Security Notice</strong>',
        '<span style="color:#374151;font-size:13px;">Never share this code with anyone. <strong>Highlight Pro will never ask for your OTP</strong> over phone or chat.<br>If you did not request this code, you can safely ignore this email.</span>'
      ].join(''),
      bgColor: "#f9fafb",
      borderColor: "#d1d5db",
    })}
  `;

  const htmlContent = buildEmailHtml({ subtitle: "Email Verification", bodyHtml });

  // Dev mode — log OTP to console clearly so developers can test without real SMTP
  if (!transporter) {
    console.log("");
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║   EMAIL OTP (Dev Mode — Not Sent via SMTP)      ║");
    console.log("╠══════════════════════════════════════════════════╣");
    console.log(`║   To:  ${toEmail.padEnd(42)}║`);
    console.log(`║   OTP: ${otp.padEnd(42)}║`);
    console.log("╚══════════════════════════════════════════════════╝");
    console.log("");
    return true;
  }

  try {
    await transporter.sendMail({
      from: `"${env.smtp.fromName}" <${env.smtp.fromEmail}>`,
      to: toEmail,
      subject: `${otp} — Your Highlight Pro verification code`,
      html: htmlContent,
      attachments: SHARED_ATTACHMENTS,
    });
    console.log(`[OTP] Email sent to: ${toEmail}`);
    return true;
  } catch (err) {
    console.error(`[OTP] Failed to send email to ${toEmail}:`, err.message);
    throw new Error("Failed to send OTP email. Please try again.");
  }
}

// Startup warning if SMTP is not configured
if (!env.smtp.isConfigured) {
  console.warn("");
  console.warn("╔══════════════════════════════════════════════════════════╗");
  console.warn("║  ⚠️  SMTP NOT CONFIGURED                                ║");
  console.warn("║  Password reset and dealer notification emails will      ║");
  console.warn("║  only be logged to console, not actually sent.           ║");
  console.warn("║  Set SMTP_HOST and SMTP_USER in server/.env to enable.   ║");
  console.warn("╚══════════════════════════════════════════════════════════╝");
  console.warn("");
}
