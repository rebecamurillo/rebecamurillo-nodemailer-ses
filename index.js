const AWS = require("aws-sdk");
const nodemailer = require("nodemailer");

const AWS_REGION_SES = process.env.AWS_REGION_SES;
const DEFAULT_FROM_EMAIL = process.env.DEFAULT_FROM_EMAIL;
const DEFAULT_TO_EMAIL = process.env.DEFAULT_TO_EMAIL;
const CAPTCHA_SECRET_KEY = process.env.CAPTCHA_SECRET_KEY;
// Comma-separated list, e.g. "https://rebecamurillo.com,https://rebeca.murillo.link"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

AWS.config.update({ region: AWS_REGION_SES });

const ses = new AWS.SES({ apiVersion: "2010-12-01" });
const transporter = nodemailer.createTransport({
  SES: { ses, aws: { region: AWS_REGION_SES } },
});

exports.handler = async (event) => {
  console.log("event: ", event);

  const headers = event.headers || {};
  const origin = headers.origin || headers.Origin;
  const response = (statusCode, body) => buildResponse(statusCode, body, origin);

  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return response(204);
  }

  const { recaptchaResponse, to, from, subject, text } = JSON.parse(
    event.body || "{}"
  );

  // Step 1: Validate the reCAPTCHA response
  const captchaValidationResult = await validateCaptcha(recaptchaResponse);
  if (!captchaValidationResult.success) {
    return response(400, { message: "reCAPTCHA verification failed" });
  }

  // Step 2: Validate input parameters
  const inputValidationResult = validateInputParameters(
    to,
    from,
    subject,
    text
  );
  if (!inputValidationResult.valid) {
    return response(400, { message: "Invalid input parameters" });
  }

  // Step 3: Send email
  const emailSendingResult = await sendEmail(to, from, subject, text);
  if (emailSendingResult.error) {
    return response(500, {
      message: "Error sending message",
      error: emailSendingResult.error,
    });
  }

  return response(200, { message: "Email sent successfully" });
};

function buildResponse(statusCode, body, origin) {
  // Echo the caller's origin only when it is in the allowed list
  const allowOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "OPTIONS,POST",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    },
    body: body === undefined ? "" : JSON.stringify(body),
  };
}

async function validateCaptcha(recaptchaResponse) {
  if (!CAPTCHA_SECRET_KEY) {
    // If no secret key is provided, skip the validation
    return { success: true };
  }
  const response = await fetch(
    "https://www.google.com/recaptcha/api/siteverify",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        secret: CAPTCHA_SECRET_KEY,
        response: recaptchaResponse,
      }),
    }
  );

  const data = await response.json();
  console.log("recaptcha response: ", data);
  return data;
}

function validateInputParameters(to, from, subject, text) {
  if (
    (to && typeof to !== "string") ||
    (from && typeof from !== "string") ||
    typeof subject !== "string" ||
    typeof text !== "string"
  ) {
    return { valid: false };
  }

  return { valid: true };
}

async function sendEmail(to, from, subject, text) {
  const params = {
    from: from || DEFAULT_FROM_EMAIL,
    to: to || DEFAULT_TO_EMAIL,
    subject,
    text,
  };

  try {
    let info = await transporter.sendMail(params);
    console.log("Message sent: %s", info.messageId);
    return { success: true };
  } catch (error) {
    console.error("Error sending message: ", error);
    return { error };
  }
}
