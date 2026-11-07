"""
email_service.py
-----------------
Sends real low-attendance reminder emails via Gmail SMTP (smtp.gmail.com).

Setup (one-time):
  1. Turn on 2-Step Verification on the Gmail account you want to send from:
     https://myaccount.google.com/security
  2. Create an "App Password" (Google Account -> Security -> 2-Step
     Verification -> App passwords). Choose "Mail" as the app. Google gives
     you a 16-character password — this is NOT your normal Gmail password.
  3. Copy backend/.env.example to backend/.env and fill in:
        GMAIL_ADDRESS=youraddress@gmail.com
        GMAIL_APP_PASSWORD=the16charapppassword
     (.env is only read locally — never commit it / share it.)

That's it — /api/send-reminders will now send real emails through this
Gmail account.
"""

import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from dotenv import load_dotenv

load_dotenv()

GMAIL_ADDRESS = os.getenv("GMAIL_ADDRESS")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD")

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465  # SSL


def _build_message(sender: str, recipient: dict, subject: str) -> MIMEMultipart:
    msg = MIMEMultipart()
    msg["From"] = sender
    msg["To"] = recipient["email"]
    msg["Subject"] = subject

    pct = recipient.get("pct")
    enrollment = recipient.get("enrollment", "-")
    pct_line = f"{pct}%" if pct is not None else "below the required threshold"

    body = (
        f"Dear {recipient['name']},\n\n"
        f"This is an automated notice from the Attendance Ledger system.\n\n"
        f"Enrollment No.: {enrollment}\n"
        f"Current Attendance: {pct_line}\n\n"
        f"Your attendance has fallen below the minimum required percentage. "
        f"Please make sure to attend upcoming classes regularly to avoid "
        f"being detained/debarred from examinations.\n\n"
        f"Regards,\n"
        f"Attendance Ledger"
    )
    msg.attach(MIMEText(body, "plain"))
    return msg


def send_reminder_emails(subject: str, recipients: list[dict]) -> dict:
    """Send one email per recipient via Gmail SMTP.

    Returns {"sent": [emails...], "failed": [{"email":..., "error":...}]}
    """
    if not GMAIL_ADDRESS or not GMAIL_APP_PASSWORD:
        raise RuntimeError(
            "Gmail is not configured. Create backend/.env (see backend/.env.example) "
            "with GMAIL_ADDRESS and GMAIL_APP_PASSWORD, then restart the backend."
        )

    sent, failed = [], []

    try:
        server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT)
        server.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
    except smtplib.SMTPAuthenticationError:
        raise RuntimeError(
            "Gmail login failed. Double-check GMAIL_ADDRESS and GMAIL_APP_PASSWORD "
            "in backend/.env — remember it must be a 16-character App Password, "
            "not your normal Gmail password."
        )

    try:
        for recipient in recipients:
            try:
                msg = _build_message(GMAIL_ADDRESS, recipient, subject)
                server.sendmail(GMAIL_ADDRESS, recipient["email"], msg.as_string())
                sent.append(recipient["email"])
            except Exception as e:  # noqa: BLE001 - report per-recipient failure
                failed.append({"email": recipient["email"], "error": str(e)})
    finally:
        server.quit()

    return {"sent": sent, "failed": failed}
