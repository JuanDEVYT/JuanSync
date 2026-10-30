// JuanSync – Kino sync provider plugin
// Syncs Kino data across devices through juansync.pythonanywhere.com

const BASE = "https://juansync.pythonanywhere.com";

const es = () => !String(kino.lang || "es").toLowerCase().startsWith("en");
const t = (esText, enText) => (es() ? esText : enText);

function fail(code, detail, say) {
  const e = say
    ? kino.error(code, detail, { userMessage: say })
    : kino.error(code, detail);
  try { e.say = say || null; } catch (_) {}
  return e;
}

function getToken() {
  const token = String(kino.config.get("token") || "").trim();
  if (!token) {
    throw fail(
      "auth_required",
      "token missing",
      t("Falta el token. Pulsa Registrarse o pégalo de otro dispositivo.",
        "Token missing. Tap Register or paste it from another device.")
    );
  }
  return token;
}

async function call(method, extraHeaders, body) {
  const token = getToken();
  let r;
  try {
    r = await kino.fetch(BASE + "/blob", {
      method,
      headers: { Authorization: "Bearer " + token, ...extraHeaders },
      body,
      redirect: "manual",
      cookies: false,
      timeoutMs: 30000,
    });
  } catch (e) {
    if (e && e.code === "too_large") {
      throw fail("unavailable", "blob too large",
        t("La copia es demasiado grande.", "The copy is too large."));
    }
    if (e && e.code === "rate_limited") throw kino.error("rate_limited", "kino.fetch budget");
    throw fail("unavailable", "server unreachable: " + (e && e.code),
      t("No se pudo conectar con el servidor.", "Could not reach the server."));
  }
  if (r.status === 401) {
    throw fail("auth_required", "401",
      t("Token no válido. Regístrate de nuevo o pega el token correcto.",
        "Invalid token. Register again or paste the correct token."));
  }
  if (r.status === 413) {
    throw fail("unavailable", "413",
      t("La copia es demasiado grande para el servidor.", "The copy is too large for the server."));
  }
  if (r.status === 429) throw kino.error("rate_limited", "429");
  return r;
}

const versionOf = (r) => {
  const v = String(r.headers["x-version"] || "").trim();
  if (!v) {
    throw fail("unavailable", "no X-Version",
      t("El servidor no respondió correctamente.", "The server did not respond correctly."));
  }
  return v;
};

// --- Sync exports ---

export async function syncPull() {
  const r = await call("GET", {});
  if (r.status === 204) return null;
  if (r.status !== 200) throw kino.error("unavailable", "pull status " + r.status);
  const version = versionOf(r);
  return { blob: r.base64(), version };
}

export async function syncPush({ blob, expectedVersion, maxBlobBytes }) {
  if (typeof blob !== "string" || !blob) throw kino.error("invalid_request", "no blob");
  if (maxBlobBytes && Math.floor((blob.length * 3) / 4) > maxBlobBytes + 2) {
    throw kino.error("invalid_request", "blob over maxBlobBytes");
  }
  const r = await call("PUT", {
    "If-Match": expectedVersion == null || expectedVersion === "" ? "0" : String(expectedVersion),
    "Content-Type": "application/octet-stream",
  }, { base64: blob });
  if (r.status === 409) {
    throw kino.error("conflict", "stored copy changed (server " + String(r.headers["x-version"] || "?") + ")");
  }
  if (r.status !== 200) throw kino.error("unavailable", "push status " + r.status);
  return { version: versionOf(r) };
}

export async function syncStatus() {
  try {
    const r = await call("HEAD", {});
    if (r.status === 204) {
      return { ready: true, message: t("Conectado. Esperando la primera sincronización.", "Connected. Waiting for the first sync.") };
    }
    if (r.status === 200) {
      return { ready: true, message: t("Conectado.", "Connected.") };
    }
    return { ready: false, message: t("El servidor respondió " + r.status + ".", "The server answered " + r.status + ".") };
  } catch (e) {
    return { ready: false, message: (e && e.say) || t("No se pudo consultar el servidor.", "Could not reach the server.") };
  }
}

// --- Settings form ---

async function describe() {
  const s = await syncStatus();
  return s.message;
}

export async function settingsStatus() {
  if (!String(kino.config.get("token") || "").trim()) {
    return { status: t("Pulsa Registrarse o recupera tu cuenta.", "Tap Register or recover your account.") };
  }
  return { status: await describe() };
}

export async function action(key) {
  if (key === "register") {
    const existing = String(kino.config.get("token") || "").trim();
    if (existing) {
      return { message: t("Ya tienes un token. Si deseas uno nuevo, bórralo primero.", "You already have a token. Clear it first if you want a new one.") };
    }
    let r;
    try {
      r = await kino.fetch(BASE + "/register", {
        method: "POST",
        cookies: false,
        timeoutMs: 15000,
      });
    } catch (e) {
      return { message: t("No se pudo conectar con el servidor.", "Could not reach the server.") };
    }
    if (r.status !== 201) {
      return { message: t("Error al registrarse. Intenta de nuevo.", "Registration failed. Try again.") };
    }
    const data = r.json() || {};
    if (!data.token) {
      return { message: t("Respuesta inesperada del servidor.", "Unexpected server response.") };
    }

    const link = data.linkCode ? ` Código vinculación Telegram: ${data.linkCode}. Envía /vincular ${data.linkCode} a @JuanSync_bot` : "";
    return {
      setSettings: { token: data.token },
      message: t("Cuenta creada y token guardado." + link, "Account created and token saved." + link),
    };
  }

  if (key === "requestRecover") {
    const tgUser = String(kino.config.get("tgUser") || "").trim().replace(/^@/, "");
    if (!tgUser) {
      return { message: t("Escribe tu nombre de usuario de Telegram primero.", "Type your Telegram username first.") };
    }
    let r;
    try {
      r = await kino.fetch(BASE + "/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: tgUser }),
        cookies: false,
        timeoutMs: 15000,
      });
    } catch (e) {
      return { message: t("Error de red: " + (e && (e.message || e.code || String(e))), "Network error: " + (e && (e.message || e.code || String(e)))) };
    }
    if (r.status !== 200) {
      const msg = r.text() || "";
      return { message: msg.trim() || t("Usuario de Telegram no encontrado o no vinculado.", "Telegram user not found or not linked.") };
    }
    return { message: t("¡Código enviado por Telegram a @" + tgUser + "! Ingrésalo abajo y pulsa Restaurar.", "Code sent via Telegram to @" + tgUser + "! Enter it below and tap Restore.") };
  }

  if (key === "confirmRecover") {
    const tgUser = String(kino.config.get("tgUser") || "").trim().replace(/^@/, "");
    const code = String(kino.config.get("verifyCode") || "").trim();
    if (!tgUser || !code) {
      return { message: t("Ingresa tu usuario de Telegram y el código recibido.", "Enter your Telegram username and the received code.") };
    }
    let r;
    try {
      r = await kino.fetch(BASE + "/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: tgUser, code }),
        cookies: false,
        timeoutMs: 15000,
      });
    } catch (e) {
      return { message: t("Error de red: " + (e && (e.message || e.code || String(e))), "Network error: " + (e && (e.message || e.code || String(e)))) };
    }
    if (r.status !== 200) {
      const msg = r.text() || "";
      return { message: msg.trim() || t("Código incorrecto o expirado.", "Invalid or expired code.") };
    }
    const data = r.json() || {};
    if (!data.token) {
      return { message: t("Respuesta inválida del servidor.", "Invalid server response.") };
    }
    return {
      setSettings: { token: data.token, verifyCode: "" },
      message: t("¡Cuenta restaurada con éxito! El token se ha configurado.", "Account restored successfully! Token has been configured."),
    };
  }

  if (key === "check") {
    return { message: await describe() };
  }
  return { message: t("Nada que hacer.", "Nothing to do.") };
}

export async function validateSettings(values) {
  const out = {};
  const token = String(values.token || "").trim();
  if (token && token.length < 32) {
    out.token = t("Ese token es muy corto. Debe tener al menos 32 caracteres.",
      "That token is too short. It must be at least 32 characters.");
  }
  return Object.keys(out).length ? out : null;
}
