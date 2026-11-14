import { createClient } from "npm:@supabase/supabase-js@2";

/* =========================================================
   VAYANA BACKEND 2.6
   Based on VAYANA BACKEND 2.5
========================================================= */

const PROJECT_URL = Deno.env.get("PROJECT_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const CLOUDFLARE_ACCOUNT_ID = Deno.env.get("CLOUDFLARE_ACCOUNT_ID") ?? "";
const CLOUDFLARE_API_TOKEN = Deno.env.get("CLOUDFLARE_API_TOKEN") ?? "";
const CLOUDFLARE_AI_MODEL = Deno.env.get("CLOUDFLARE_AI_MODEL") ??
  "@cf/meta/llama-3.1-8b-instruct";

const RESEND_FROM_EMAIL =
  Deno.env.get("RESEND_FROM_EMAIL") ??
  "Vayana <onboarding@resend.dev>";

const NOTIFICATION_EMAIL = "xboad514725@gmail.com";

const BUCKET = "payment-proofs";
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const REQUEST_STATUSES = [
  "pending",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
  "rejected",
];

const REQUEST_TABLES: Record<string, string> = {
  tour: "tour_requests",
  transportation: "transportation_requests",
  felucca: "felucca_requests",
  customer_service: "service_requests",
  flight: "flight_requests",
  stay: "stay_requests",
};

const ADMIN_ACTIONS = new Set([
  "dashboard_stats",
  "list_requests",
  "update_request_status",
  "list_customers",
  "list_bookings",
  "list_payment_verifications",
  "get_payment_proof_url",
  "approve_payment",
  "reject_payment",
  "list_chats",
  "get_chat_messages",
  "reply_chat",
  "update_chat_status",
  "list_offer_requests",
  "update_offer_request_status",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const supabase = createClient(PROJECT_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

/* =========================================================
   GENERAL HELPERS
========================================================= */

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function apiError(
  message: string,
  status = 400,
  debug?: string,
) {
  return respond({
    brand: "Vayana",
    status: "error",
    message,
    ...(debug ? { debug } : {}),
  }, status);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizePhone(value: unknown): string {
  let phone = String(value ?? "").replace(/\D/g, "");
  if (phone.startsWith("00")) phone = phone.slice(2);
  return phone;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) &&
    value.length <= 254;
}

function isValidPhone(value: string): boolean {
  const phone = normalizePhone(value);
  return phone.length >= 7 && phone.length <= 20;
}

function validateContact(email: string, phone: string): string | null {
  if (!email) return "Email is required.";
  if (!isValidEmail(email)) return "A valid email address is required.";

  if (!phone) return "Phone number is required.";
  if (!isValidPhone(phone)) return "A valid phone number is required.";

  return null;
}

function isValidUUID(value: unknown): boolean {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(value);
}

function cleanText(value: unknown, maxLength = 1000): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function escapeHtml(value: unknown): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    return entities[char];
  });
}

function readableLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) =>
    c.toUpperCase()
  );
}

/* =========================================================
   CAIRO DATE VALIDATION
========================================================= */

function cairoTodayISO(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";

  return `${year}-${month}-${day}`;
}

function addDaysISO(dateString: string, days: number): string {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isValidDate(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00Z`);

  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

function validateRequiredDate(
  value: unknown,
  label: string,
  minimumDate = cairoTodayISO(),
): string | null {
  const date = cleanText(value, 30);

  if (!date) return `${label} is required.`;
  if (!isValidDate(date)) return `${label} must be a valid date.`;
  if (date < minimumDate) return `${label} cannot be in the past.`;

  return null;
}

/* =========================================================
   RESEND EMAIL
========================================================= */

async function sendRequestEmail(
  requestType: string,
  customer: {
    full_name: string;
    email?: string | null;
    phone?: string | null;
  },
  details: Record<string, unknown>,
): Promise<{ sent: boolean; error?: string }> {
  if (!RESEND_API_KEY) {
    return {
      sent: false,
      error: "RESEND_API_KEY is not configured.",
    };
  }

  const rows: [string, string][] = [
    ["Request type", readableLabel(requestType)],
    ["Customer", customer.full_name],
    ["Email", customer.email || "Not provided"],
    ["Phone", customer.phone || "Not provided"],
  ];

  for (const [key, value] of Object.entries(details)) {
    rows.push([
      readableLabel(key),
      value === null || value === undefined || value === ""
        ? "Not provided"
        : typeof value === "object"
        ? JSON.stringify(value)
        : String(value),
    ]);
  }

  const htmlRows = rows.map(([label, value]) =>
    `<tr>
      <td style="padding:10px;border:1px solid #ddd;font-weight:bold">
        ${escapeHtml(label)}
      </td>
      <td style="padding:10px;border:1px solid #ddd">
        ${escapeHtml(value)}
      </td>
    </tr>`
  ).join("");

  const textBody = rows
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [NOTIFICATION_EMAIL],
        subject: `New Vayana ${readableLabel(requestType)} Request`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#111">
            <h2>New Vayana Website Request</h2>
            <p>A new request was submitted through the Vayana website.</p>
            <table style="border-collapse:collapse;width:100%">
              ${htmlRows}
            </table>
          </div>
        `,
        text: textBody,
      }),
    });

    const responseText = await response.text();

    if (!response.ok) {
      return {
        sent: false,
        error: `Resend error ${response.status}: ${responseText.slice(0, 500)}`,
      };
    }

    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      error: errorMessage(error),
    };
  }
}

/* =========================================================
   DATABASE + EMAIL
   Save first. Send email only after successful DB insert.
========================================================= */

async function saveRequestAndNotify(
  table: string,
  requestData: Record<string, unknown>,
  requestType: string,
  customer: {
    full_name: string;
    email?: string | null;
    phone?: string | null;
  },
  emailDetails: Record<string, unknown>,
) {
  const { data, error } = await supabase
    .from(table)
    .insert(requestData)
    .select("*")
    .single();

  if (error || !data) {
    return apiError(
      "The request could not be saved in the database.",
      500,
      errorMessage(error),
    );
  }

  const email = await sendRequestEmail(
    requestType,
    customer,
    emailDetails,
  );

  return respond({
    brand: "Vayana",
    status: "success",
    message: email.sent
      ? "Request saved and notification email sent."
      : "Request saved, but notification email could not be sent.",
    request_type: requestType,
    request: data,
    database_saved: true,
    email_sent: email.sent,
    email_to: NOTIFICATION_EMAIL,
    ...(email.error ? { email_error: email.error } : {}),
  });
}

/* =========================================================
   STORAGE
========================================================= */

async function ensureBucket() {
  const { data: bucket, error } =
    await supabase.storage.getBucket(BUCKET);

  if (bucket && !error) return;

  const { error: createError } =
    await supabase.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: MAX_FILE_SIZE,
      allowedMimeTypes: [
        "image/jpeg",
        "image/png",
        "application/pdf",
      ],
    });

  if (
    createError &&
    !createError.message.toLowerCase().includes("already")
  ) {
    throw createError;
  }
}

function detectFileType(
  bytes: Uint8Array,
): { mime: string; extension: string } | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { mime: "image/jpeg", extension: "jpg" };
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { mime: "image/png", extension: "png" };
  }

  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return { mime: "application/pdf", extension: "pdf" };
  }

  return null;
}

/* =========================================================
   PAYMENT PROOF
========================================================= */

async function handlePaymentProof(req: Request) {
  const form = await req.formData();

  const tourRequestId = cleanText(
    form.get("tour_request_id"),
    100,
  );

  const paymentMethod = cleanText(
    form.get("payment_method"),
    100,
  );

  // A request UUID is an identifier, not proof of ownership.
  // Require both customer contact details before accepting a payment proof.
  const customerEmail = normalizeEmail(form.get("email"));
  const customerPhone = normalizePhone(form.get("phone"));

  const file = form.get("file");

  if (!isValidUUID(tourRequestId)) {
    return apiError("Valid tour request ID is required.");
  }

  if (!paymentMethod) {
    return apiError("Payment method is required.");
  }

  const contactError = validateContact(customerEmail, customerPhone);
  if (contactError) return apiError(contactError);

  if (!(file instanceof File)) {
    return apiError("Payment proof file is required.");
  }

  if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
    return apiError("File must be smaller than 5 MB.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectFileType(bytes);

  if (!detected) {
    return apiError(
      "Only valid JPG, PNG, or PDF files are supported.",
    );
  }

  await ensureBucket();

  const { data: tour, error: tourError } = await supabase
    .from("tour_requests")
    .select("id, customer_id")
    .eq("id", tourRequestId)
    .maybeSingle();

  if (tourError) {
    return apiError(
      "Unable to verify tour request.",
      500,
      tourError.message,
    );
  }

  if (!tour) {
    return apiError("Tour request was not found.", 404);
  }

  if (!tour.customer_id) {
    return apiError("Tour request has no customer.", 400);
  }

  const { data: owner, error: ownerError } = await supabase
    .from("customers")
    .select("email, phone")
    .eq("id", tour.customer_id)
    .maybeSingle();

  if (ownerError) {
    return apiError("Unable to verify customer ownership.", 500);
  }

  if (
    !owner ||
    normalizeEmail(owner.email) !== customerEmail ||
    normalizePhone(owner.phone) !== customerPhone
  ) {
    return apiError(
      "The email and phone must both match the original tour request.",
      403,
    );
  }

  const { data: existing, error: existingError } = await supabase
    .from("booking_verifications")
    .select("id")
    .eq("tour_request_id", tourRequestId)
    .eq("payment_status", "pending")
    .limit(1);

  if (existingError) {
    return apiError(
      "Unable to check previous payment proof.",
      500,
      existingError.message,
    );
  }

  if (existing?.length) {
    return apiError(
      "A payment proof is already awaiting review.",
      409,
    );
  }

  const filePath =
    `${tour.customer_id}/${crypto.randomUUID()}.${detected.extension}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, bytes, {
      contentType: detected.mime,
      upsert: false,
    });

  if (uploadError) {
    return apiError(
      "Unable to upload payment proof.",
      500,
      uploadError.message,
    );
  }

  const { data: verification, error: insertError } =
    await supabase
      .from("booking_verifications")
      .insert({
        customer_id: tour.customer_id,
        tour_request_id: tourRequestId,
        payment_method: paymentMethod,
        payment_proof_path: filePath,
        booking_source: "vayana",
        payment_status: "pending",
      })
      .select("id, payment_status, created_at")
      .single();

  if (insertError) {
    await supabase.storage.from(BUCKET).remove([filePath]);

    return apiError(
      "Unable to save payment verification.",
      500,
      insertError.message,
    );
  }

  return respond({
    brand: "Vayana",
    status: "success",
    message: "Payment proof submitted successfully.",
    verification,
  });
}

/* =========================================================
   ADMIN AUTHENTICATION
========================================================= */

async function authenticateAdmin(req: Request) {
  const authorization = req.headers.get("Authorization") ?? "";

  if (!authorization.startsWith("Bearer ")) {
    return {
      error: "Authorization token is required.",
      status: 401,
    };
  }

  const token = authorization.slice(7);

  const { data: authData, error: authError } =
    await supabase.auth.getUser(token);

  if (authError || !authData.user) {
    return {
      error: "Invalid or expired login session.",
      status: 401,
    };
  }

  const { data: admin, error: adminError } = await supabase
    .from("admin_users")
    .select("user_id, role")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (adminError || !admin || admin.role !== "admin") {
    return {
      error: "Administrator access denied.",
      status: 403,
    };
  }

  return {
    user: authData.user,
    admin,
  };
}

/* =========================================================
   PAYMENT REVIEW
========================================================= */

async function handleAdminReview(
  body: Record<string, unknown>,
  adminUserId: string,
) {
  const verificationId = cleanText(body.verification_id, 100);
  const action = cleanText(body.action, 50);
  const reviewNotes = cleanText(body.review_notes, 2000);

  if (!isValidUUID(verificationId)) {
    return apiError("Valid verification ID is required.");
  }

  if (!["approve_payment", "reject_payment"].includes(action)) {
    return apiError("Invalid payment review action.");
  }

  const { data: verification, error: fetchError } =
    await supabase
      .from("booking_verifications")
      .select("id, payment_status")
      .eq("id", verificationId)
      .maybeSingle();

  if (fetchError) {
    return apiError(
      "Unable to load payment verification.",
      500,
      fetchError.message,
    );
  }

  if (!verification) {
    return apiError("Payment verification not found.", 404);
  }

  if (verification.payment_status !== "pending") {
    return apiError(
      "This payment has already been reviewed.",
      409,
    );
  }

  if (action === "reject_payment") {
    const { data, error } = await supabase
      .from("booking_verifications")
      .update({
        payment_status: "rejected",
        reviewed_by: adminUserId,
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes || null,
      })
      .eq("id", verificationId)
      .eq("payment_status", "pending")
      .select("id, payment_status, reviewed_at")
      .maybeSingle();

    if (error) {
      return apiError(
        "Unable to reject payment.",
        500,
        error.message,
      );
    }

    if (!data) {
      return apiError("Payment was already reviewed.", 409);
    }

    return respond({
      brand: "Vayana",
      status: "success",
      message: "Payment rejected.",
      verification: data,
    });
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const bookingCode = "VAY-" +
      crypto.randomUUID().replace(/-/g, "")
        .slice(0, 10).toUpperCase();

    const { data, error } = await supabase
      .from("booking_verifications")
      .update({
        payment_status: "paid",
        booking_code: bookingCode,
        verified_at: new Date().toISOString(),
        reviewed_by: adminUserId,
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes || null,
      })
      .eq("id", verificationId)
      .eq("payment_status", "pending")
      .select("id, payment_status, booking_code, verified_at")
      .maybeSingle();

    if (!error && data) {
      return respond({
        brand: "Vayana",
        status: "success",
        message: "Payment approved.",
        verification: data,
      });
    }

    if (
      error &&
      !error.message.toLowerCase().includes("duplicate")
    ) {
      return apiError(
        "Unable to approve payment.",
        500,
        error.message,
      );
    }

    if (!data && !error) {
      return apiError("Payment was already reviewed.", 409);
    }
  }

  return apiError(
    "Unable to generate a unique booking code.",
    500,
  );
}

/* =========================================================
   CUSTOMER SERVICE REQUEST
========================================================= */

async function handleCustomerServiceRequest(
  body: Record<string, unknown>,
) {
  const serviceDays = Number(body.service_days ?? 1);
  const bookingCode = cleanText(body.booking_code, 100);
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phone);
  const fullName = cleanText(body.full_name, 200);

  const contactError = validateContact(email, phone);
  if (contactError) return apiError(contactError);

  const serviceStartDate = cleanText(
    body.service_start_date,
    30,
  );

  const details = cleanText(body.details, 3000);

  const dateError = validateRequiredDate(
    serviceStartDate,
    "Service start date",
  );

  if (dateError) return apiError(dateError);

  if (
    !Number.isInteger(serviceDays) ||
    serviceDays < 1 ||
    serviceDays > 30
  ) {
    return apiError("Service days must be between 1 and 30.");
  }

  if (!fullName) {
    return apiError("Customer name is required.");
  }

  let customerId: string | null = null;
  let verificationId: string | null = null;
  let freeService = false;

  let customerForEmail: {
    full_name: string;
    email?: string | null;
    phone?: string | null;
  };

  if (bookingCode) {
    const { data: verification, error } = await supabase
      .from("booking_verifications")
      .select("id, customer_id, payment_status")
      .eq("booking_code", bookingCode)
      .maybeSingle();

    if (error) {
      return apiError(
        "Unable to verify booking code.",
        500,
        error.message,
      );
    }

    if (
      !verification ||
      verification.payment_status !== "paid"
    ) {
      return apiError(
        "Booking code is invalid or not paid.",
        403,
      );
    }

    if (!verification.customer_id) {
      return apiError("Booking has no linked customer.", 403);
    }

    const { data: customer, error: customerError } =
      await supabase
        .from("customers")
        .select("id, full_name, email, phone")
        .eq("id", verification.customer_id)
        .maybeSingle();

    if (customerError || !customer) {
      return apiError(
        "Unable to verify customer details.",
        403,
      );
    }

    const emailMatches =
      normalizeEmail(customer.email) === email;

    const phoneMatches =
      normalizePhone(customer.phone) === phone;

    // BOTH email and phone must match.
    if (!emailMatches || !phoneMatches) {
      return apiError(
        "Email and phone number must both match the booking.",
        403,
      );
    }

    customerId = customer.id;
    verificationId = verification.id;
    freeService = true;

    customerForEmail = {
      full_name: customer.full_name,
      email: customer.email,
      phone: customer.phone,
    };
  } else {
    const { data: customer, error } = await supabase
      .from("customers")
      .insert({
        full_name: fullName,
        email,
        phone: cleanText(body.phone, 50),
      })
      .select("id, full_name, email, phone")
      .single();

    if (error || !customer) {
      return apiError(
        "Unable to create customer.",
        500,
        error?.message,
      );
    }

    customerId = customer.id;

    customerForEmail = {
      full_name: customer.full_name,
      email: customer.email,
      phone: customer.phone,
    };
  }

  const price = freeService ? 0 : serviceDays * 2;

  const requestData = {
    customer_id: customerId,
    service_days: serviceDays,
    service_start_date: serviceStartDate,
    details: details || null,
    has_purchased_trip: freeService,
    price_usd: price,
    payment_status: freeService ? "paid" : "pending",
    booking_verification_id: verificationId,
    status: "pending",
  };

  return await saveRequestAndNotify(
    "service_requests",
    requestData,
    "customer_service",
    customerForEmail,
    {
      service_start_date: serviceStartDate,
      service_days: serviceDays,
      details,
      has_purchased_trip: freeService,
      price_usd: price,
      booking_code: bookingCode || "Not provided",
    },
  );
}

/* =========================================================
   NORMAL CUSTOMER REQUESTS
========================================================= */

async function handleNormalRequest(
  body: Record<string, unknown>,
) {
  const requestType = cleanText(
    body.request_type || "tour",
    50,
  );

  if (requestType === "customer_service") {
    return await handleCustomerServiceRequest(body);
  }

  const table = REQUEST_TABLES[requestType];

  if (!table) {
    return apiError("Invalid request type.");
  }

  const fullName = cleanText(body.full_name, 200);
  const email = normalizeEmail(body.email);
  const phone = cleanText(body.phone, 50);

  if (!fullName) {
    return apiError("Customer name is required.");
  }

  const contactError = validateContact(email, phone);
  if (contactError) return apiError(contactError);

  let requestData: Record<string, unknown> = {
    status: "pending",
  };

  const emailDetails: Record<string, unknown> = {};

  /* TOUR */

  if (requestType === "tour") {
    const guests = Number(body.guests ?? 1);
    const packageName = cleanText(body.package_name, 200);

    if (!packageName) {
      return apiError("Package name is required.");
    }

    if (
      !Number.isInteger(guests) ||
      guests < 1 ||
      guests > 50
    ) {
      return apiError("Guests must be between 1 and 50.");
    }

    const arrivalDate = cleanText(body.arrival_date, 30);
    const departureDate = cleanText(body.departure_date, 30);
    const preferredTourDate = cleanText(
      body.preferred_tour_date,
      30,
    );

    const dateFields = [
      [arrivalDate, "Arrival date"],
      [departureDate, "Departure date"],
      [preferredTourDate, "Preferred tour date"],
    ] as const;

    for (const [value, label] of dateFields) {
      const error = validateRequiredDate(value, label);
      if (error) return apiError(error);
    }

    if (departureDate < arrivalDate) {
      return apiError(
        "Departure date cannot be before arrival date.",
      );
    }

    if (
      preferredTourDate < arrivalDate ||
      preferredTourDate > departureDate
    ) {
      return apiError(
        "Preferred tour date must be between arrival and departure dates.",
      );
    }

    requestData = {
      ...requestData,
      package_name: packageName,
      package_id: isValidUUID(body.package_id)
        ? body.package_id
        : null,
      arrival_date: arrivalDate,
      departure_date: departureDate,
      preferred_tour_date: preferredTourDate,
      preferred_tour_time: cleanText(
        body.preferred_tour_time,
        50,
      ) || null,
      hotel_category: cleanText(
        body.hotel_category,
        100,
      ) || null,
      comfort_level: cleanText(
        body.comfort_level,
        100,
      ) || null,
      guests,
      notes: cleanText(body.notes, 3000) || null,
    };

    Object.assign(emailDetails, {
      package_name: packageName,
      guests,
      arrival_date: arrivalDate,
      departure_date: departureDate,
      preferred_tour_date: preferredTourDate,
      preferred_tour_time: body.preferred_tour_time,
      hotel_category: body.hotel_category,
      comfort_level: body.comfort_level,
      notes: body.notes,
    });
  }

  /* TRANSPORTATION */

  if (requestType === "transportation") {
    const passengers = Number(body.passengers ?? 1);
    const serviceType = cleanText(body.service_type, 100);

    if (!serviceType) {
      return apiError(
        "Transportation service type is required.",
      );
    }

    if (
      !Number.isInteger(passengers) ||
      passengers < 1 ||
      passengers > 50
    ) {
      return apiError(
        "Passengers must be between 1 and 50.",
      );
    }

    const pickupDate = cleanText(body.pickup_date, 30);
    const dropoffDate = cleanText(body.dropoff_date, 30);

    const pickupDateError = validateRequiredDate(
      pickupDate,
      "Pickup date",
    );

    if (pickupDateError) return apiError(pickupDateError);

    const dropoffDateError = validateRequiredDate(
      dropoffDate,
      "Dropoff date",
    );

    if (dropoffDateError) return apiError(dropoffDateError);

    if (dropoffDate < pickupDate) {
      return apiError(
        "Dropoff date cannot be before pickup date.",
      );
    }

    requestData = {
      ...requestData,
      service_type: serviceType,
      pickup_location: cleanText(
        body.pickup_location,
        300,
      ) || null,
      dropoff_location: cleanText(
        body.dropoff_location,
        300,
      ) || null,
      pickup_date: pickupDate,
      pickup_time: cleanText(
        body.pickup_time,
        50,
      ) || null,
      dropoff_date: dropoffDate,
      dropoff_time: cleanText(
        body.dropoff_time,
        50,
      ) || null,
      passengers,
      notes: cleanText(body.notes, 3000) || null,
    };

    Object.assign(emailDetails, {
      service_type: serviceType,
      pickup_location: body.pickup_location,
      dropoff_location: body.dropoff_location,
      pickup_date: pickupDate,
      pickup_time: body.pickup_time,
      dropoff_date: dropoffDate,
      dropoff_time: body.dropoff_time,
      passengers,
      notes: body.notes,
    });
  }

  /* FELUCCA */

  if (requestType === "felucca") {
    const passengers = Number(body.passengers ?? 1);
    const preferredDate = cleanText(
      body.preferred_date,
      30,
    );

    const dateError = validateRequiredDate(
      preferredDate,
      "Preferred date",
    );

    if (dateError) return apiError(dateError);

    if (
      !Number.isInteger(passengers) ||
      passengers < 1 ||
      passengers > 50
    ) {
      return apiError(
        "Passengers must be between 1 and 50.",
      );
    }

    requestData = {
      ...requestData,
      preferred_date: preferredDate,
      passengers,
      sunset_preference: Boolean(body.sunset_preference),
      notes: cleanText(body.notes, 3000) || null,
    };

    Object.assign(emailDetails, {
      preferred_date: preferredDate,
      passengers,
      sunset_preference: Boolean(body.sunset_preference),
      notes: body.notes,
    });
  }

  /* FLIGHT */

  if (requestType === "flight") {
    const tripType = cleanText(body.trip_type, 30).toLowerCase();
    const departureCity = cleanText(body.departure_city, 150);
    const arrivalCity = cleanText(body.arrival_city, 150);
    const departureDate = cleanText(body.departure_date, 30);
    const returnDate = cleanText(body.return_date, 30);
    const passengers = Number(body.passengers ?? 1);
    const cabinClass = cleanText(body.cabin_class || "economy", 30).toLowerCase();
    const airlinePreference = cleanText(body.airline_preference, 150);
    const notes = cleanText(body.notes, 3000);

    if (!["one_way", "round_trip", "multi_city"].includes(tripType)) {
      return apiError("Flight trip type must be one_way, round_trip, or multi_city.");
    }
    if (departureCity.length < 2 || arrivalCity.length < 2) {
      return apiError("Departure and arrival cities are required.");
    }
    const departureError = validateRequiredDate(departureDate, "Departure date");
    if (departureError) return apiError(departureError);
    if (tripType === "round_trip" && !returnDate) {
      return apiError("Return date is required for a round trip.");
    }
    if (returnDate) {
      const returnError = validateRequiredDate(returnDate, "Return date");
      if (returnError) return apiError(returnError);
      if (returnDate <= departureDate) {
        return apiError("Return date must be after departure date.");
      }
    }
    if (!Number.isInteger(passengers) || passengers < 1 || passengers > 50) {
      return apiError("Passengers must be between 1 and 50.");
    }
    if (!["economy", "premium_economy", "business", "first"].includes(cabinClass)) {
      return apiError("Invalid cabin class.");
    }

    requestData = {
      ...requestData,
      trip_type: tripType,
      departure_city: departureCity,
      arrival_city: arrivalCity,
      departure_date: departureDate,
      return_date: returnDate || null,
      passengers,
      cabin_class: cabinClass,
      airline_preference: airlinePreference || null,
      notes: notes || null,
    };
    Object.assign(emailDetails, {
      trip_type: tripType,
      departure_city: departureCity,
      arrival_city: arrivalCity,
      departure_date: departureDate,
      return_date: returnDate || "Not applicable",
      passengers,
      cabin_class: cabinClass,
      airline_preference: airlinePreference,
      notes,
    });
  }

  /* STAY / ACCOMMODATION */

  if (requestType === "stay") {
    const hotelCategory = cleanText(body.hotel_category, 50);
    const hotelName = cleanText(body.hotel_name, 200);
    const preferredArea = cleanText(body.preferred_area, 150);
    const comfortLevel = cleanText(body.comfort_level, 100);
    const checkInDate = cleanText(body.check_in_date, 30);
    const checkOutDate = cleanText(body.check_out_date, 30);
    const guests = Number(body.guests ?? 1);
    const rooms = Number(body.rooms ?? 1);
    const mealPlan = cleanText(body.meal_plan, 100);
    const notes = cleanText(body.notes, 3000);

    if (!hotelCategory) return apiError("Hotel category is required.");
    const checkInError = validateRequiredDate(checkInDate, "Check-in date");
    if (checkInError) return apiError(checkInError);
    const checkOutError = validateRequiredDate(checkOutDate, "Check-out date");
    if (checkOutError) return apiError(checkOutError);
    if (checkOutDate <= checkInDate) {
      return apiError("Check-out date must be after check-in date.");
    }
    if (!Number.isInteger(guests) || guests < 1 || guests > 50) {
      return apiError("Guests must be between 1 and 50.");
    }
    if (!Number.isInteger(rooms) || rooms < 1 || rooms > 25) {
      return apiError("Rooms must be between 1 and 25.");
    }

    requestData = {
      ...requestData,
      hotel_category: hotelCategory,
      hotel_name: hotelName || null,
      preferred_area: preferredArea || null,
      comfort_level: comfortLevel || null,
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      guests,
      rooms,
      meal_plan: mealPlan || null,
      notes: notes || null,
    };
    Object.assign(emailDetails, {
      hotel_category: hotelCategory,
      hotel_name: hotelName,
      preferred_area: preferredArea,
      comfort_level: comfortLevel,
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      guests,
      rooms,
      meal_plan: mealPlan,
      notes,
    });
  }

  /* CREATE CUSTOMER */

  const { data: customer, error: customerError } =
    await supabase
      .from("customers")
      .insert({
        full_name: fullName,
        email,
        phone,
      })
      .select("id, full_name, email, phone")
      .single();

  if (customerError || !customer) {
    return apiError(
      "Unable to create customer.",
      500,
      customerError?.message,
    );
  }

  requestData.customer_id = customer.id;

  return await saveRequestAndNotify(
    table,
    requestData,
    requestType,
    {
      full_name: customer.full_name,
      email: customer.email,
      phone: customer.phone,
    },
    emailDetails,
  );
}

/* =========================================================
   SEASONAL OFFER REQUESTS
========================================================= */

async function handleOfferRequest(body: Record<string, unknown>) {
  const offerType = cleanText(body.offer_type, 30).toLowerCase();
  if (!["christmas", "winter", "eclipse"].includes(offerType)) {
    return apiError("Offer type must be christmas, winter, or eclipse.");
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("offer_campaigns")
    .select("*")
    .eq("offer_type", offerType)
    .maybeSingle();

  if (campaignError) {
    return apiError("Unable to verify offer availability.", 500, campaignError.message);
  }
  if (!campaign || !campaign.is_active) {
    return apiError("This offer is not currently available.");
  }

  const today = cairoTodayISO();
  if (campaign.booking_deadline && today > campaign.booking_deadline) {
    return apiError("The booking period for this offer has ended.");
  }

  const fullName = cleanText(body.full_name, 150);
  const email = normalizeEmail(body.email);
  const phone = cleanText(body.phone, 50);
  if (fullName.length < 2) return apiError("A valid full name is required.");
  const contactError = validateContact(email, phone);
  if (contactError) return apiError(contactError);

  const arrivalDate = cleanText(body.arrival_date, 30);
  const departureDate = cleanText(body.departure_date, 30);
  const pickupDate = cleanText(body.pickup_date, 30);
  const pickupLocationType = cleanText(body.pickup_location_type, 40);

  for (const [value, label] of [
    [arrivalDate, "Arrival date"],
    [departureDate, "Departure date"],
    [pickupDate, "Pickup date"],
  ] as Array<[string, string]>) {
    const dateError = validateRequiredDate(value, label);
    if (dateError) return apiError(dateError);
  }

  if (departureDate <= arrivalDate) {
    return apiError("Departure date must be after arrival date.");
  }
  if (pickupDate < arrivalDate || pickupDate > departureDate) {
    return apiError("Pickup date must be within your stay dates.");
  }
  if (!["Airport", "Train Station", "Bus Station"].includes(pickupLocationType)) {
    return apiError("Choose Airport, Train Station, or Bus Station as the pickup location type.");
  }

  if (campaign.travel_start_date && arrivalDate < campaign.travel_start_date) {
    return apiError(`This offer is available for arrivals from ${campaign.travel_start_date}.`);
  }
  if (campaign.travel_end_date && departureDate > campaign.travel_end_date) {
    return apiError(`This offer is available for departures up to ${campaign.travel_end_date}.`);
  }

  if (offerType === "eclipse" &&
      (arrivalDate > "2027-08-02" || departureDate < "2027-08-02")) {
    return apiError("Solar Eclipse 2027 stay dates must include August 2, 2027.");
  }

  const guests = Number(body.guests ?? 1);
  const rooms = Number(body.rooms ?? 1);
  if (!Number.isInteger(guests) || guests < 1 || guests > 50) {
    return apiError("Guests must be between 1 and 50.");
  }
  if (!Number.isInteger(rooms) || rooms < 1 || rooms > 25) {
    return apiError("Rooms must be between 1 and 25.");
  }

  const mealPlan = cleanText(body.meal_plan, 50);
  if (offerType === "christmas" &&
      !["breakfast_dinner", "breakfast_lunch"].includes(mealPlan)) {
    return apiError("Christmas meal plan must be breakfast_dinner or breakfast_lunch.");
  }
  if (offerType === "winter" && mealPlan !== "breakfast_dinner") {
    return apiError("Winter offer only supports breakfast_dinner.");
  }
  if (offerType === "eclipse" && mealPlan !== "not_applicable") {
    return apiError("Solar Eclipse offer meal plan must be not_applicable.");
  }

  const experienceOption = cleanText(body.experience_option, 120);
  const eclipseViewingType = cleanText(body.eclipse_viewing_type, 60);
  const preferredTemple = cleanText(body.preferred_temple, 150);
  const eclipseOptions = [
    "Accommodation Only",
    "Transportation to a chosen temple",
    "360° Rooftop Table Reservation",
    "Accommodation + Eclipse Experience",
  ];

  if (offerType === "eclipse") {
    if (!eclipseOptions.includes(experienceOption)) {
      return apiError("Choose one Solar Eclipse experience.");
    }
    if (experienceOption === "Transportation to a chosen temple" && !preferredTemple) {
      return apiError("Your preferred temple is required.");
    }
    if (experienceOption === "Accommodation + Eclipse Experience") {
      if (!["Temple", "360° Rooftop Table"].includes(eclipseViewingType)) {
        return apiError("Choose Temple or 360° Rooftop Table for your eclipse experience.");
      }
      if (eclipseViewingType === "Temple" && !preferredTemple) {
        return apiError("Your preferred temple is required.");
      }
    }
  }

  const notes = cleanText(body.notes, 3000);
  const offerData = {
    offer_type: offerType,
    full_name: fullName,
    email,
    phone,
    arrival_date: arrivalDate,
    departure_date: departureDate,
    pickup_date: pickupDate,
    pickup_location_type: pickupLocationType,
    experience_option: experienceOption || null,
    eclipse_viewing_type: eclipseViewingType || null,
    preferred_temple: preferredTemple || null,
    guests,
    rooms,
    meal_plan: mealPlan,
    notes: notes || null,
    status: "pending",
  };

  return await saveRequestAndNotify(
    "offer_requests",
    offerData,
    `${offerType}_offer_booking`,
    { full_name: fullName, email, phone },
    {
      offer_type: offerType,
      offer_name: campaign.offer_name,
      booking_deadline: campaign.booking_deadline,
      travel_period: campaign.travel_start_date && campaign.travel_end_date
        ? `${campaign.travel_start_date} to ${campaign.travel_end_date}`
        : "Flexible dates around August 2, 2027",
      arrival_date: arrivalDate,
      departure_date: departureDate,
      pickup_date: pickupDate,
      pickup_location_type: pickupLocationType,
      experience_option: experienceOption,
      eclipse_viewing_type: eclipseViewingType,
      preferred_temple: preferredTemple,
      guests,
      rooms,
      meal_plan: mealPlan,
      notes,
    },
  );
}

/* =========================================================
   CREATE YOUR GIFT REQUESTS
========================================================= */

async function handleGiftRequest(body: Record<string, unknown>) {
  const recipientName = cleanText(body.recipient_name, 150);
  const senderName = cleanText(body.sender_name, 150);
  const email = normalizeEmail(body.email);
  const phone = cleanText(body.phone, 50);
  const giftDate = cleanText(body.gift_date, 30);

  if (recipientName.length < 2) return apiError("Recipient name is required.");
  if (senderName.length < 2) return apiError("Sender name is required.");
  const contactError = validateContact(email, phone);
  if (contactError) return apiError(contactError);

  const dateError = validateRequiredDate(giftDate, "Gift / experience date");
  if (dateError) return apiError(dateError);

  const rawItems = body.selected_items;
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 30) {
    return apiError("Choose at least one gift experience.");
  }

  const allowedCategories = new Set([
    "balloon", "offers", "packages", "felucca", "flights", "accommodation",
  ]);
  const selectedItems: Array<Record<string, string>> = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return apiError("Invalid gift selection.");
    }
    const item = raw as Record<string, unknown>;
    const category = cleanText(item.category, 40);
    const label = cleanText(item.item, 180);
    if (!allowedCategories.has(category) || !label) {
      return apiError("Invalid gift selection.");
    }
    selectedItems.push({
      category,
      item: label,
      ...(category === "packages" ? { tour_page_url: "tours.html#packagesPanel" } : {}),
    });
  }

  const personalMessage = cleanText(body.personal_message, 2000);
  const giftData = {
    recipient_name: recipientName,
    sender_name: senderName,
    personal_message: personalMessage || null,
    gift_date: giftDate,
    email,
    phone,
    selected_items: selectedItems,
    status: "pending",
  };

  return await saveRequestAndNotify(
    "gift_requests",
    giftData,
    "create_your_gift",
    { full_name: senderName, email, phone },
    {
      recipient_name: recipientName,
      sender_name: senderName,
      selected_items: selectedItems,
      personal_message: personalMessage,
      gift_date: giftDate,
    },
  );
}

/* =========================================================
   DASHBOARD STATISTICS
========================================================= */

async function getCount(
  table: string,
  status?: string,
): Promise<number> {
  let query = supabase
    .from(table)
    .select("id", {
      count: "exact",
      head: true,
    });

  if (status) query = query.eq("status", status);

  const { count, error } = await query;

  if (error) throw error;

  return count ?? 0;
}

async function dashboardStats() {
  const jobs: Array<[string, Promise<number>]> = [];

  const tables = [
    "tour_requests",
    "transportation_requests",
    "felucca_requests",
    "service_requests",
    "offer_requests",
    "gift_requests",
    "customers",
    "booking_verifications",
    "payments",
    "chat_conversations",
    "flight_requests",
    "stay_requests",
  ];

  for (const table of tables) {
    jobs.push([`${table}_total`, getCount(table)]);
  }

  for (const table of [
    "tour_requests",
    "transportation_requests",
    "felucca_requests",
    "service_requests",
    "offer_requests",
    "gift_requests",
    "flight_requests",
    "stay_requests",
  ]) {
    jobs.push([
      `${table}_pending`,
      getCount(table, "pending"),
    ]);
  }

  jobs.push(
    [
      "pending_payment_verifications",
      getCount("booking_verifications", "pending"),
    ],
    [
      "paid_booking_verifications",
      getCount("booking_verifications", "paid"),
    ],
    [
      "open_chats",
      getCount("chat_conversations", "open"),
    ],
    [
      "christmas_offer_requests",
      countOffersByType("christmas"),
    ],
    [
      "winter_offer_requests",
      countOffersByType("winter"),
    ],
  );

  const results = await Promise.all(
    jobs.map(async ([key, promise]) => {
      try {
        return [key, await promise, null] as const;
      } catch (error) {
        return [key, 0, errorMessage(error)] as const;
      }
    }),
  );

  const dashboard: Record<string, number> = {};
  const errors: Record<string, string> = {};

  for (const [key, value, error] of results) {
    dashboard[key] = value;
    if (error) errors[key] = error;
  }

  return respond({
    brand: "Vayana",
    status: "success",
    dashboard,
    ...(Object.keys(errors).length ? { count_errors: errors } : {}),
  });
}

async function countOffersByType(type: string): Promise<number> {
  const { count, error } = await supabase
    .from("offer_requests")
    .select("id", { count: "exact", head: true })
    .eq("offer_type", type);

  if (error) throw error;

  return count ?? 0;
}

/* =========================================================
   ADMIN: LIST REQUESTS
========================================================= */

async function listRequests(
  body: Record<string, unknown>,
) {
  const type = cleanText(body.request_type, 50);
  const table = REQUEST_TABLES[type];

  if (!table) return apiError("Invalid request type.");

  const limit = Math.min(
    Math.max(Number(body.limit ?? 50), 1),
    100,
  );

  const offset = Math.max(Number(body.offset ?? 0), 0);
  const status = cleanText(body.status, 50);

  let query = supabase
    .from(table)
    .select("*, customers(full_name, email, phone)", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (REQUEST_STATUSES.includes(status)) {
    query = query.eq("status", status);
  }

  const { data, error, count } = await query;

  if (error) {
    return apiError(
      "Unable to load requests.",
      500,
      error.message,
    );
  }

  return respond({
    brand: "Vayana",
    status: "success",
    request_type: type,
    total: count ?? 0,
    requests: data ?? [],
  });
}

/* =========================================================
   ADMIN: UPDATE REQUEST STATUS
========================================================= */

async function updateRequestStatus(
  body: Record<string, unknown>,
) {
  const type = cleanText(body.request_type, 50);
  const table = REQUEST_TABLES[type];
  const requestId = cleanText(body.request_id, 100);
  const status = cleanText(body.new_status, 50);

  if (!table) return apiError("Invalid request type.");
  if (!isValidUUID(requestId)) {
    return apiError("Valid request ID is required.");
  }
  if (!REQUEST_STATUSES.includes(status)) {
    return apiError("Invalid request status.");
  }

  const { data, error } = await supabase
    .from(table)
    .update({ status })
    .eq("id", requestId)
    .select("*")
    .maybeSingle();

  if (error) {
    return apiError(
      "Unable to update request.",
      500,
      error.message,
    );
  }

  if (!data) return apiError("Request not found.", 404);

  return respond({
    brand: "Vayana",
    status: "success",
    message: "Request status updated.",
    request: data,
  });
}

/* =========================================================
   ADMIN: LIST OFFER BOOKINGS
========================================================= */

async function listOfferRequests(
  body: Record<string, unknown>,
) {
  const limit = Math.min(
    Math.max(Number(body.limit ?? 50), 1),
    100,
  );

  const offset = Math.max(Number(body.offset ?? 0), 0);
  const status = cleanText(body.status, 50);
  const offerType = cleanText(body.offer_type, 30);

  let query = supabase
    .from("offer_requests")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (REQUEST_STATUSES.includes(status)) {
    query = query.eq("status", status);
  }

  if (["christmas", "winter", "eclipse"].includes(offerType)) {
    query = query.eq("offer_type", offerType);
  }

  const { data, error, count } = await query;

  if (error) {
    return apiError(
      "Unable to load offer bookings.",
      500,
      error.message,
    );
  }

  return respond({
    brand: "Vayana",
    status: "success",
    total: count ?? 0,
    offer_requests: data ?? [],
  });
}

/* =========================================================
   ADMIN: UPDATE OFFER BOOKING STATUS
========================================================= */

async function updateOfferRequestStatus(
  body: Record<string, unknown>,
) {
  const requestId = cleanText(body.request_id, 100);
  const status = cleanText(body.new_status, 50);

  if (!isValidUUID(requestId)) {
    return apiError("Valid offer request ID is required.");
  }

  if (!REQUEST_STATUSES.includes(status)) {
    return apiError("Invalid offer booking status.");
  }

  const { data, error } = await supabase
    .from("offer_requests")
    .update({ status })
    .eq("id", requestId)
    .select("*")
    .maybeSingle();

  if (error) {
    return apiError(
      "Unable to update offer booking.",
      500,
      error.message,
    );
  }

  if (!data) {
    return apiError("Offer booking not found.", 404);
  }

  return respond({
    brand: "Vayana",
    status: "success",
    message: "Offer booking status updated.",
    offer_request: data,
  });
}

/* =========================================================
   ADMIN: CUSTOMERS
========================================================= */

async function listCustomers(
  body: Record<string, unknown>,
) {
  const limit = Math.min(
    Math.max(Number(body.limit ?? 50), 1),
    100,
  );

  const offset = Math.max(Number(body.offset ?? 0), 0);
  const search = cleanText(body.search, 100);

  let query = supabase
    .from("customers")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) {
    const safeSearch = search.replace(/[,%()]/g, "");
    query = query.ilike("full_name", `%${safeSearch}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    return apiError(
      "Unable to load customers.",
      500,
      error.message,
    );
  }

  return respond({
    brand: "Vayana",
    status: "success",
    total: count ?? 0,
    customers: data ?? [],
  });
}

/* =========================================================
   ADMIN: PAYMENT VERIFICATIONS / BOOKINGS
========================================================= */

async function listBookings(
  body: Record<string, unknown>,
) {
  const limit = Math.min(
    Math.max(Number(body.limit ?? 50), 1),
    100,
  );

  const offset = Math.max(Number(body.offset ?? 0), 0);
  const paymentStatus = cleanText(body.payment_status, 50);

  let query = supabase
    .from("booking_verifications")
    .select(`
      id,
      customer_id,
      booking_code,
      booking_source,
      external_platform,
      external_reference,
      payment_status,
      verified_at,
      created_at,
      tour_request_id,
      payment_method,
      payment_proof_path,
      reviewed_by,
      review_notes,
      reviewed_at,
      customers(full_name, email, phone)
    `, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (["pending", "paid", "rejected"].includes(paymentStatus)) {
    query = query.eq("payment_status", paymentStatus);
  }

  const { data, error, count } = await query;

  if (error) {
    return apiError(
      "Unable to load payment verifications.",
      500,
      error.message,
    );
  }

  return respond({
    brand: "Vayana",
    status: "success",
    total: count ?? 0,
    bookings: data ?? [],
  });
}

/* =========================================================
   ADMIN: SIGNED PAYMENT PROOF URL
========================================================= */

async function getPaymentProofUrl(
  body: Record<string, unknown>,
) {
  const verificationId = cleanText(body.verification_id, 100);

  if (!isValidUUID(verificationId)) {
    return apiError("Valid verification ID is required.");
  }

  const { data: verification, error } = await supabase
    .from("booking_verifications")
    .select("payment_proof_path")
    .eq("id", verificationId)
    .maybeSingle();

  if (error) {
    return apiError(
      "Unable to load payment proof.",
      500,
      error.message,
    );
  }

  if (!verification?.payment_proof_path) {
    return apiError("No payment proof is attached.", 404);
  }

  const { data, error: signedError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(verification.payment_proof_path, 300);

  if (signedError || !data?.signedUrl) {
    return apiError(
      "Unable to create secure payment proof link.",
      500,
      signedError?.message,
    );
  }

  return respond({
    brand: "Vayana",
    status: "success",
    signed_url: data.signedUrl,
    expires_in_seconds: 300,
  });
}

/* =========================================================
   CHAT TOKEN HELPERS
========================================================= */

async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function validatePublicChatToken(
  conversationId: string,
  token: string,
) {
  if (!isValidUUID(conversationId) || token.length < 20) {
    return null;
  }

  const tokenHash = await hashToken(token);

  const { data, error } = await supabase
    .from("chat_conversations")
    .select("id, customer_id, chat_type, status")
    .eq("id", conversationId)
    .eq("access_token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) return null;

  return data;
}

/* =========================================================
   GEMINI AI TRAVEL CHAT
========================================================= */

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const GROQ_MODEL = "openai/gpt-oss-120b";

const PRICE_REPLIES: Record<string, string> = {
  en: "Prices may vary because the tourism market is constantly changing. Rates can go up or down depending on availability, season, and service conditions. Please submit a request to receive the latest available quotation.",
  ar: "الأسعار ممكن تختلف لأن سوق السياحة بيتغير باستمرار. الأسعار ممكن ترتفع أو تنخفض حسب التوافر والموسم وظروف الخدمة. من فضلك ابعت طلب من خلال الموقع عشان تستقبل أحدث عرض سعر متاح.",
  fr: "Les prix peuvent varier, car le marché du tourisme évolue constamment. Les tarifs peuvent augmenter ou diminuer selon les disponibilités, la saison et les conditions du service. Envoyez une demande sur le site pour recevoir le devis le plus récent.",
  es: "Los precios pueden variar porque el mercado turístico cambia constantemente. Las tarifas pueden subir o bajar según la disponibilidad, la temporada y las condiciones del servicio. Envía una solicitud en el sitio para recibir la cotización más reciente.",
};

function detectMessageLanguage(value: string): string {
  if (/[\u0600-\u06FF]/.test(value)) return "ar";
  const lower = value.toLowerCase();
  if (/\b(prix|tarif|tarifs|coût|cout|combien|devis|hébergement|réservation|séjour|bonjour|merci)\b/.test(lower) || /[àâçéèêëîïôûùüÿœ]/i.test(value)) return "fr";
  if (/\b(precio|precios|cuánto|cuanto|tarifa|tarifas|presupuesto|cotización|cotizacion|alojamiento|reserva|hola|gracias)\b/.test(lower) || /[áéíóúñ¿¡]/i.test(value)) return "es";
  return "en";
}

function isArabicText(value: string): boolean {
  return detectMessageLanguage(value) === "ar";
}

function isPriceQuestion(value: string): boolean {
  return /\b(price|prices|cost|costs|how much|rate|rates|fee|fees|budget|quotation|quote|prix|tarif|tarifs|coût|cout|combien|devis|precio|precios|cuánto|cuanto|tarifa|tarifas|presupuesto|cotización|cotizacion)\b|سعر|اسعار|أسعار|تكلف|بكام|كم السعر|الاسعار|التكلفة|تكلفة|عرض سعر/i.test(value);
}

function offlineTravelReply(message: string): string {
  const language = detectMessageLanguage(message);
  const lower = message.toLowerCase();

  if (isPriceQuestion(message)) return PRICE_REPLIES[language] ?? PRICE_REPLIES.en;

  const replies: Record<string, Record<string, string>> = {
    balloon: {
      ar: "تجربة المنطاد في الأقصر من أشهر التجارب الصباحية، وتعتمد على حالة الطقس وموافقة التشغيل. أرسل طلب المنطاد من Vayana مع التاريخ وعدد الضيوف، وسيؤكد الفريق التفاصيل والتوافر.",
      fr: "Le vol en montgolfière au-dessus de Louxor est une expérience matinale emblématique. Il dépend de la météo et de l’autorisation de l’opérateur. Envoyez une demande avec votre date et le nombre de voyageurs afin que l’équipe confirme les détails.",
      es: "El vuelo en globo sobre Luxor es una experiencia matutina emblemática. Depende del clima y de la aprobación del operador. Envía una solicitud con la fecha y el número de viajeros para que el equipo confirme los detalles.",
      en: "A hot-air balloon ride is one of Luxor’s signature early-morning experiences. Flights depend on weather and operator approval. Submit a balloon request on Vayana with your date and guest count so the team can confirm the details."
    },
    felucca: {
      ar: "يمكنك طلب تجربة فلوكة على النيل في الأقصر، مع تحديد التاريخ وعدد الركاب وهل تفضل وقت الغروب. أرسل طلب Felucca من Vayana ليؤكد الفريق التفاصيل.",
      fr: "Vous pouvez demander une balade traditionnelle en felouque sur le Nil à Louxor. Indiquez la date, le nombre de passagers et votre préférence pour le coucher du soleil, puis envoyez votre demande sur Vayana.",
      es: "Puedes solicitar un paseo tradicional en faluca por el Nilo en Luxor. Indica la fecha, el número de pasajeros y si prefieres el atardecer; después envía tu solicitud en Vayana.",
      en: "You can request a traditional felucca experience on the Nile in Luxor. Choose your date, passenger count, and whether you prefer sunset, then submit the Felucca request on Vayana."
    },
    hotel: {
      ar: "تقدر تختار الإقامة المناسبة حسب مستوى الراحة وفئة الفندق 3 أو 4 أو 5 نجوم. أرسل طلب الإقامة من Vayana مع تواريخ الوصول والمغادرة وعدد الضيوف، والفريق هيتابع معاك.",
      fr: "Vayana peut vous aider à organiser un hébergement selon votre niveau de confort et votre préférence pour un hôtel 3, 4 ou 5 étoiles. Envoyez vos dates d’arrivée et de départ ainsi que le nombre de voyageurs.",
      es: "Vayana puede ayudarte a organizar alojamiento según tu nivel de comodidad y tu preferencia por hoteles de 3, 4 o 5 estrellas. Envía las fechas de llegada y salida y el número de huéspedes.",
      en: "Vayana can help arrange accommodation based on your comfort level and preferred 3-, 4-, or 5-star category. Submit a stay request with your arrival and departure dates and guest count."
    },
    transport: {
      ar: "Vayana تقدر تساعدك في انتقالات المطار والتنقلات الخاصة داخل الأقصر. ابعت طلب Transportation وحدد مكان الاستلام والتوصيل والتاريخ والوقت وعدد الركاب.",
      fr: "Vayana peut organiser des transferts depuis l’aéroport et des trajets privés à Louxor. Envoyez une demande avec les lieux de prise en charge et de destination, la date, l’heure et le nombre de passagers.",
      es: "Vayana puede organizar traslados desde el aeropuerto y transporte privado en Luxor. Envía una solicitud con los lugares de recogida y destino, la fecha, la hora y el número de pasajeros.",
      en: "Vayana can help arrange airport transfers and private transportation in Luxor. Submit a Transportation request with pickup and drop-off locations, date, time, and passenger count."
    },
    tour: {
      ar: "تقدر تختار جولات شرق الأقصر أو غربها أو جولة خاصة تجمع المنطقتين. من أشهر المعالم معبد الكرنك، معبد الأقصر، وادي الملوك، ومعبد حتشبسوت. ابعت طلب Tour بالتاريخ وعدد الضيوف عشان الفريق يؤكد التفاصيل.",
      fr: "Choisissez une visite de la rive Est, de la rive Ouest ou une expérience privée combinant les deux. Parmi les incontournables : Karnak, le temple de Louxor, la Vallée des Rois et le temple d’Hatchepsout. Envoyez une demande avec votre date et le nombre de voyageurs.",
      es: "Elige una visita a la Orilla Este, la Orilla Oeste o una experiencia privada que combine ambas. Entre los lugares destacados están Karnak, el Templo de Luxor, el Valle de los Reyes y el templo de Hatshepsut. Envía una solicitud con la fecha y el número de viajeros.",
      en: "You can choose East Bank tours, West Bank tours, or a private experience combining both. Highlights include Karnak Temple, Luxor Temple, the Valley of the Kings, and Hatshepsut Temple. Submit a Tour request with your date and guest count."
    },
    eclipse: {
      ar: "كسوف الشمس الكلي في الأقصر يوم 2 أغسطس 2027 مناسبة استثنائية. يمكنك الاختيار بين الإقامة فقط، أو الانتقال إلى المعبد، أو حجز طاولة على السطح بزاوية 360 درجة، أو الإقامة مع تجربة تختارها. أرسل طلبك بالتواريخ والتفاصيل.",
      fr: "L’éclipse solaire totale à Louxor, le 2 août 2027, sera un événement exceptionnel. Vous pourrez choisir l’hébergement seul, un transfert vers un temple, une table sur un toit à 360°, ou un hébergement avec l’une de ces expériences. Envoyez vos dates et préférences.",
      es: "El eclipse solar total en Luxor, el 2 de agosto de 2027, será un acontecimiento extraordinario. Podrás elegir solo alojamiento, traslado a un templo, una mesa en una azotea con vista de 360°, o alojamiento con una de estas experiencias. Envía tus fechas y preferencias.",
      en: "The total solar eclipse in Luxor on August 2, 2027 is a special event. Options include accommodation only, transportation to a temple, a 360° rooftop table reservation, or accommodation with one selected experience. Submit your dates and preferences."
    },
    general: {
      ar: "أهلًا بيك في Vayana! أقدر أساعدك بمعلومات عن الأقصر والجولات والإقامة والانتقالات وتجارب النيل. قلّي إيه نوع الرحلة اللي بتخطط لها، أو ابعت طلب من الموقع عشان فريق Vayana يتابع معاك.",
      fr: "Bienvenue chez Vayana ! Je peux vous aider à découvrir Louxor, les visites, l’hébergement, les transports et les expériences sur le Nil. Dites-moi quel voyage vous préparez ou envoyez une demande sur le site.",
      es: "¡Bienvenido a Vayana! Puedo ayudarte con información sobre Luxor, excursiones, alojamiento, transporte y experiencias en el Nilo. Cuéntame qué viaje estás planeando o envía una solicitud en el sitio.",
      en: "Welcome to Vayana! I can help with Luxor, tours, accommodation, transportation, and Nile experiences. Tell me what kind of trip you are planning, or submit a request on the website so the Vayana team can follow up."
    }
  };

  let category = "general";
  if (/balloon|hot.?air|منطاد|بالون/i.test(lower)) category = "balloon";
  else if (/felucca|فلوكة|فلوكه|مركب شراعي/i.test(lower)) category = "felucca";
  else if (/hotel|stay|accommodation|فندق|إقامة|اقامة|سكن|hôtel|hébergement|hotel|alojamiento/i.test(lower)) category = "hotel";
  else if (/transport|transfer|airport|pickup|drop.?off|مواصلات|انتقال|مطار|توصيل|transfert|transporte|traslado/i.test(lower)) category = "transport";
  else if (/tour|temple|karnak|hatshepsut|valley|معالم|جولة|كرنك|حتشبسوت|وادي الملوك|eclipse|solar|كسوف|الشمس|2027|éclipse|eclipse|eclise/i.test(lower)) category = "tour";

  return replies[category][language] ?? replies[category].en;
}

async function fetchProvider(
  url: string,
  apiKey: string,
  payload: Record<string, unknown>,
  providerName: string,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 22000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      const providerError = await response.text();
      console.error(`VAYANA_${providerName}_HTTP_ERROR`, response.status, providerError.slice(0, 700));
      return null;
    }
    const result = await response.json();
    const reply = cleanText(
      result?.choices?.[0]?.message?.content ?? result?.result?.response ?? "",
      5000,
    );
    return reply || null;
  } catch (error) {
    console.error(`VAYANA_${providerName}_FETCH_ERROR`, errorMessage(error));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateTravelAIReply(
  conversationId: string,
  latestUserMessage: string,
): Promise<{ reply: string | null; error?: string }> {
  if (isPriceQuestion(latestUserMessage)) {
    return { reply: isArabicText(latestUserMessage) ? PRICE_REPLY_AR : PRICE_REPLY_EN };
  }

  const { data: rows, error: historyError } = await supabase
    .from("chat_messages")
    .select("sender_type, message")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(16);

  if (historyError) {
    console.error("VAYANA_AI_HISTORY_ERROR", historyError.message);
    return { reply: offlineTravelReply(latestUserMessage) };
  }

  const history = (rows ?? [])
    .reverse()
    .map((row: { sender_type: string; message: string }) => ({
      role: row.sender_type === "user" ? "user" : "assistant",
      content: cleanText(row.message, 3000),
    }))
    .filter((item: { role: string; content: string }) => item.content.length > 0);

  const lastUserIndex = history.map((turn) => turn.role).lastIndexOf("user");
  const usableHistory = lastUserIndex >= 0 ? history.slice(0, lastUserIndex + 1) : [];
  if (!usableHistory.length) return { reply: offlineTravelReply(latestUserMessage) };

  const systemInstruction = [
    "You are Vayana's official AI Travel Assistant.",
    "Help visitors plan travel in Egypt, especially Luxor and nearby destinations.",
    "Vayana can help with private tours, accommodation arrangements, transportation, felucca experiences, and customer-service requests.",
    "Be welcoming, clear, practical, and concise. Detect the language of the customer's latest message and reply naturally in that same language. Support English, French, Spanish, Arabic, and any other language you can reliably understand; do not force the visitor to switch to English.",
    "Never invent or guarantee availability, reservations, confirmations, policies, inclusions, schedules, or exact prices.",
    "Do not calculate, estimate, or quote prices.",
    "When a customer wants to book or get a current quotation, guide them to submit the relevant request form on the Vayana website.",
    "If a detail is not known, say so clearly and invite the customer to submit a request so the Vayana team can confirm it.",
    "Do not claim that you have submitted a request, made a booking, contacted staff, or checked live availability.",
    "Do not request payment card details, passwords, or sensitive personal information.",
  ].join(" ");

  if (GEMINI_API_KEY) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 22000);
    try {
      const conversationText = usableHistory.map((turn) =>
        `${turn.role === "user" ? "Customer" : "Vayana assistant"}: ${turn.content}`
      ).join("\\n\\n");
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/interactions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
          body: JSON.stringify({
            model: GEMINI_MODEL,
            input: `${systemInstruction}\\n\\nConversation:\\n${conversationText}\\n\\nVayana assistant:`,
            generation_config: { max_output_tokens: 700 },
          }),
          signal: controller.signal,
        },
      );
      if (response.ok) {
        const result = await response.json();
        const reply = cleanText(
          (result?.steps ?? [])
            .filter((step: { type?: string }) => step.type === "model_output")
            .flatMap((step: { content?: { type?: string; text?: string }[] }) => step.content ?? [])
            .filter((part: { type?: string }) => part.type === "text")
            .map((part: { text?: string }) => part.text ?? "")
            .join("\\n"),
          5000,
        );
        if (reply) return { reply };
        console.error("VAYANA_GEMINI_EMPTY_RESPONSE");
      } else {
        const providerError = await response.text();
        console.error("VAYANA_GEMINI_HTTP_ERROR", response.status, providerError.slice(0, 700));
      }
    } catch (error) {
      console.error("VAYANA_GEMINI_FETCH_ERROR", errorMessage(error));
    } finally {
      clearTimeout(timeout);
    }
  }

  const providerMessages = [{ role: "system", content: systemInstruction }, ...usableHistory];

  if (GROQ_API_KEY) {
    const groqReply = await fetchProvider(
      "https://api.groq.com/openai/v1/chat/completions",
      GROQ_API_KEY,
      { model: GROQ_MODEL, messages: providerMessages, max_tokens: 700, temperature: 0.4 },
      "GROQ",
    );
    if (groqReply) return { reply: groqReply };
  }

  if (CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_API_TOKEN) {
    const cloudflareReply = await fetchProvider(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`,
      CLOUDFLARE_API_TOKEN,
      { model: CLOUDFLARE_AI_MODEL, messages: providerMessages, max_tokens: 700, temperature: 0.4 },
      "CLOUDFLARE",
    );
    if (cloudflareReply) return { reply: cloudflareReply };
  }

  console.warn("VAYANA_AI_USING_OFFLINE_FALLBACK", {
    gemini_configured: Boolean(GEMINI_API_KEY),
    groq_configured: Boolean(GROQ_API_KEY),
    cloudflare_configured: Boolean(CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_API_TOKEN),
  });
  return { reply: offlineTravelReply(latestUserMessage) };
}

async function saveAIReply(
  conversationId: string,
  userMessage: string,
): Promise<{ message: Record<string, unknown> | null; error?: string }> {
  const generated = await generateTravelAIReply(
    conversationId,
    userMessage,
  );

  if (!generated.reply) {
    return {
      message: null,
      error: generated.error ?? "AI reply unavailable.",
    };
  }

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      sender_type: "assistant",
      message: generated.reply,
    })
    .select("id, sender_type, message, created_at")
    .single();

  if (error || !data) {
    return {
      message: null,
      error: "AI reply could not be saved.",
    };
  }

  return { message: data };
}

/* =========================================================
   PUBLIC: CREATE CHAT
========================================================= */

async function createPublicChat(
  body: Record<string, unknown>,
) {
  const chatType = cleanText(body.chat_type, 50);
  const fullName = cleanText(body.full_name, 200);
  const email = normalizeEmail(body.email);
  const phone = cleanText(body.phone, 50);
  const firstMessage = cleanText(body.message, 3000);

  if (!["ai_travel", "customer_service"].includes(chatType)) {
    return apiError("Invalid chat type.");
  }

  if (!fullName) {
    return apiError("Customer name is required.");
  }

  const contactError = validateContact(email, phone);
  if (contactError) return apiError(contactError);

  const { data: customer, error: customerError } =
    await supabase
      .from("customers")
      .insert({
        full_name: fullName,
        email,
        phone,
      })
      .select("id")
      .single();

  if (customerError || !customer) {
    return apiError(
      "Unable to create chat customer.",
      500,
      customerError?.message,
    );
  }

  const accessToken = crypto.randomUUID() + crypto.randomUUID();
  const tokenHash = await hashToken(accessToken);

  const { data: conversation, error: conversationError } =
    await supabase
      .from("chat_conversations")
      .insert({
        customer_id: customer.id,
        chat_type: chatType,
        status: "open",
        access_token_hash: tokenHash,
      })
      .select("id, chat_type, status, created_at")
      .single();

  if (conversationError || !conversation) {
    return apiError(
      "Unable to create chat conversation.",
      500,
      conversationError?.message,
    );
  }

  let firstSavedMessage: Record<string, unknown> | null = null;
  let aiMessage: Record<string, unknown> | null = null;
  let aiError: string | null = null;

  if (firstMessage) {
    const { data: saved, error: messageError } = await supabase
      .from("chat_messages")
      .insert({
        conversation_id: conversation.id,
        sender_type: "user",
        message: firstMessage,
      })
      .select("id, sender_type, message, created_at")
      .single();

    if (messageError || !saved) {
      await supabase
        .from("chat_conversations")
        .delete()
        .eq("id", conversation.id);

      return apiError(
        "Unable to save first chat message.",
        500,
        messageError?.message,
      );
    }

    firstSavedMessage = saved;

    if (chatType === "ai_travel") {
      const ai = await saveAIReply(conversation.id, firstMessage);
      aiMessage = ai.message;
      aiError = ai.error ?? null;
    }
  }

  return respond({
    brand: "Vayana",
    status: "success",
    conversation,
    access_token: accessToken,
    ...(firstSavedMessage ? { user_message: firstSavedMessage } : {}),
    ...(aiMessage ? { ai_message: aiMessage } : {}),
    ...(aiError ? { ai_error: aiError } : {}),
    message: "Save this access token securely. It is shown only once.",
  });
}

/* =========================================================
   PUBLIC: READ CHAT
========================================================= */

async function getPublicChat(
  body: Record<string, unknown>,
) {
  const conversationId = cleanText(body.conversation_id, 100);
  const accessToken = cleanText(body.access_token, 200);

  const conversation = await validatePublicChatToken(
    conversationId,
    accessToken,
  );

  if (!conversation) {
    return apiError("Chat access denied.", 403);
  }

  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, sender_type, message, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(300);

  if (error) {
    return apiError(
      "Unable to load chat messages.",
      500,
      error.message,
    );
  }

  return respond({
    brand: "Vayana",
    status: "success",
    conversation,
    messages: data ?? [],
  });
}

/* =========================================================
   PUBLIC: SEND CHAT MESSAGE
========================================================= */

async function sendPublicChatMessage(
  body: Record<string, unknown>,
) {
  const conversationId = cleanText(body.conversation_id, 100);
  const accessToken = cleanText(body.access_token, 200);
  const message = cleanText(body.message, 3000);

  if (!message) return apiError("Message cannot be empty.");

  const conversation = await validatePublicChatToken(
    conversationId,
    accessToken,
  );

  if (!conversation) {
    return apiError("Chat access denied.", 403);
  }

  if (conversation.status !== "open") {
    return apiError("This conversation is closed.", 409);
  }

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      sender_type: "user",
      message,
    })
    .select("id, sender_type, message, created_at")
    .single();

  if (error) {
    return apiError(
      "Unable to send message.",
      500,
      error.message,
    );
  }

  let aiMessage: Record<string, unknown> | null = null;
  let aiError: string | null = null;

  if (conversation.chat_type === "ai_travel") {
    const ai = await saveAIReply(conversationId, message);
    aiMessage = ai.message;
    aiError = ai.error ?? null;
  }

  return respond({
    brand: "Vayana",
    status: "success",
    message: data,
    ...(aiMessage ? { ai_message: aiMessage } : {}),
    ...(aiError ? { ai_error: aiError } : {}),
  });
}

/* =========================================================
   ADMIN: LIST CHATS
========================================================= */

async function listChats(
  body: Record<string, unknown>,
) {
  const limit = Math.min(
    Math.max(Number(body.limit ?? 50), 1),
    100,
  );

  const offset = Math.max(Number(body.offset ?? 0), 0);
  const status = cleanText(body.status, 20);
  const chatType = cleanText(body.chat_type, 50);

  let query = supabase
    .from("chat_conversations")
    .select(
      "id, customer_id, chat_type, status, created_at, customers(full_name, email, phone)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (["open", "closed"].includes(status)) {
    query = query.eq("status", status);
  }

  if (["ai_travel", "customer_service"].includes(chatType)) {
    query = query.eq("chat_type", chatType);
  }

  const { data, error, count } = await query;

  if (error) {
    return apiError(
      "Unable to load chats.",
      500,
      error.message,
    );
  }

  return respond({
    brand: "Vayana",
    status: "success",
    total: count ?? 0,
    conversations: data ?? [],
  });
}

/* =========================================================
   ADMIN: READ CHAT MESSAGES
========================================================= */

async function getAdminChatMessages(
  body: Record<string, unknown>,
) {
  const conversationId = cleanText(body.conversation_id, 100);

  if (!isValidUUID(conversationId)) {
    return apiError("Valid conversation ID is required.");
  }

  const { data: conversation, error: conversationError } =
    await supabase
      .from("chat_conversations")
      .select("id, customer_id, chat_type, status, created_at")
      .eq("id", conversationId)
      .maybeSingle();

  if (conversationError || !conversation) {
    return apiError(
      "Conversation not found.",
      404,
      conversationError?.message,
    );
  }

  const { data: messages, error } = await supabase
    .from("chat_messages")
    .select("id, sender_type, message, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    return apiError(
      "Unable to load messages.",
      500,
      error.message,
    );
  }

  return respond({
    brand: "Vayana",
    status: "success",
    conversation,
    messages: messages ?? [],
  });
}

/* =========================================================
   ADMIN: REPLY TO CHAT
========================================================= */

async function adminReplyChat(
  body: Record<string, unknown>,
) {
  const conversationId = cleanText(body.conversation_id, 100);
  const message = cleanText(body.message, 3000);

  if (!isValidUUID(conversationId)) {
    return apiError("Valid conversation ID is required.");
  }

  if (!message) {
    return apiError("Message cannot be empty.");
  }

  const { data: conversation, error: conversationError } =
    await supabase
      .from("chat_conversations")
      .select("id, status")
      .eq("id", conversationId)
      .maybeSingle();

  if (conversationError || !conversation) {
    return apiError("Conversation not found.", 404);
  }

  if (conversation.status !== "open") {
    return apiError("This conversation is closed.", 409);
  }

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      sender_type: "admin",
      message,
    })
    .select("id, sender_type, message, created_at")
    .single();

  if (error) {
    return apiError(
      "Unable to send admin reply.",
      500,
      error.message,
    );
  }

  return respond({
    brand: "Vayana",
    status: "success",
    message: data,
  });
}

/* =========================================================
   ADMIN: OPEN / CLOSE CHAT
========================================================= */

async function updateChatStatus(
  body: Record<string, unknown>,
) {
  const conversationId = cleanText(body.conversation_id, 100);
  const status = cleanText(body.status, 20);

  if (!isValidUUID(conversationId)) {
    return apiError("Valid conversation ID is required.");
  }

  if (!["open", "closed"].includes(status)) {
    return apiError("Chat status must be open or closed.");
  }

  const { data, error } = await supabase
    .from("chat_conversations")
    .update({ status })
    .eq("id", conversationId)
    .select("id, status")
    .maybeSingle();

  if (error) {
    return apiError(
      "Unable to update chat status.",
      500,
      error.message,
    );
  }

  if (!data) return apiError("Conversation not found.", 404);

  return respond({
    brand: "Vayana",
    status: "success",
    conversation: data,
  });
}

/* =========================================================
   ADMIN ACTION ROUTER
========================================================= */

async function handleAdminAction(
  body: Record<string, unknown>,
  adminUserId: string,
) {
  const action = cleanText(body.action, 100);

  switch (action) {
    case "dashboard_stats":
      return await dashboardStats();

    case "list_requests":
      return await listRequests(body);

    case "update_request_status":
      return await updateRequestStatus(body);

    case "list_customers":
      return await listCustomers(body);

    case "list_bookings":
    case "list_payment_verifications":
      return await listBookings(body);

    case "get_payment_proof_url":
      return await getPaymentProofUrl(body);

    case "approve_payment":
    case "reject_payment":
      return await handleAdminReview(body, adminUserId);

    case "list_chats":
      return await listChats(body);

    case "get_chat_messages":
      return await getAdminChatMessages(body);

    case "reply_chat":
      return await adminReplyChat(body);

    case "update_chat_status":
      return await updateChatStatus(body);

    case "list_offer_requests":
      return await listOfferRequests(body);

    case "update_offer_request_status":
      return await updateOfferRequestStatus(body);

    default:
      return apiError("Unknown administrator action.", 400);
  }
}

/* =========================================================
   MAIN REQUEST HANDLER
========================================================= */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (!PROJECT_URL || !SERVICE_ROLE_KEY) {
    return apiError(
      "Backend environment is not configured.",
      500,
    );
  }

  try {
    /* HEALTH CHECK */

    if (req.method === "GET") {
      return respond({
        brand: "Vayana",
        status: "online",
        version: "2.8",
        message: "Vayana Backend 2.8 is responding.",
      });
    }

    if (req.method !== "POST") {
      return apiError("Method not allowed.", 405);
    }

    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      return await handlePaymentProof(req);
    }

    if (!contentType.includes("application/json")) {
      return apiError(
        "Content-Type must be application/json or multipart/form-data.",
      );
    }

    const body = await req.json();

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return apiError("Invalid request body.");
    }

    const action = cleanText(body.action, 100);

    /* PUBLIC CHAT */

    if (action === "create_chat") {
      return await createPublicChat(body);
    }

    if (action === "get_public_chat") {
      return await getPublicChat(body);
    }

    if (action === "send_public_chat_message") {
      return await sendPublicChatMessage(body);
    }

    /* ADMIN */

    if (ADMIN_ACTIONS.has(action)) {
      const adminResult = await authenticateAdmin(req);

      if ("error" in adminResult) {
        return apiError(
          adminResult.error,
          adminResult.status,
        );
      }

      return await handleAdminAction(
        body,
        adminResult.user.id,
      );
    }

    /* UNKNOWN ACTION */

    if (action) {
      return apiError("Unknown action.", 400);
    }

    /* PUBLIC OFFER REQUESTS */

    if (body.request_type === "offer") {
      return await handleOfferRequest(body);
    }

    if (body.request_type === "gift") {
      return await handleGiftRequest(body);
    }

    if (body.offer_type) {
      return await handleOfferRequest(body);
    }

    /* PUBLIC CUSTOMER REQUESTS */

    return await handleNormalRequest(body);
  } catch (error) {
    console.error("VAYANA_BACKEND_ERROR", errorMessage(error));

    return apiError(
      "Unable to process request.",
      500,
      errorMessage(error),
    );
  }
});