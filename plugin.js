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

function getToken(required = true) {
  const token = String(kino.config.get("token") || "").trim();
  if (!token) {
    if (!required) return null;
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

    const link = data.linkCode ? `\n\nCódigo de vinculación para Telegram:\n${data.linkCode}\n\nAbre @JuanSync_bot en Telegram y envía:\n/vincular ${data.linkCode}` : "";
    return {
      setSettings: { token: data.token },
      message: t("🎉 ¡Cuenta creada con éxito!" + link, "🎉 Account created successfully!" + link),
    };
  }

  if (key === "showLinkCode") {
    const token = getToken(false);
    if (!token) {
      return { message: t("No tienes una cuenta configurada. Pulsa «Registrarse» primero.", "No account configured. Tap «Register» first.") };
    }
    let r;
    try {
      r = await kino.fetch(BASE + "/link-code", {
        method: "GET",
        headers: { "Authorization": "Bearer " + token },
        cookies: false,
        timeoutMs: 15000,
      });
    } catch (e) {
      return { message: t("Error de conexión al obtener el código.", "Connection error while fetching code.") };
    }
    if (r.status !== 200) {
      return { message: t("No se pudo obtener el código de vinculación.", "Could not retrieve linking code.") };
    }
    const data = r.json() || {};
    const code = data.linkCode || "";
    if (data.linked) {
      const userTag = data.telegramUser ? " (@" + data.telegramUser + ")" : "";
      return {
        message: t(
          "ℹ️ Tu cuenta ya está vinculada a Telegram" + userTag + ".\n\nSi deseas vincular otro chat, tu código es:\n" + code + "\n\nEnvía en Telegram a @JuanSync_bot:\n/vincular " + code,
          "ℹ️ Your account is already linked to Telegram" + userTag + ".\n\nTo link another chat, your code is:\n" + code + "\n\nSend to @JuanSync_bot on Telegram:\n/vincular " + code
        ),
      };
    }
    return {
      message: t(
        "📱 Código de vinculación para Telegram:\n\n" + code + "\n\nAbre @JuanSync_bot en Telegram y envía:\n/vincular " + code,
        "📱 Telegram linking code:\n\n" + code + "\n\nOpen @JuanSync_bot on Telegram and send:\n/vincular " + code
      ),
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
    if (r.status === 404) {
      return { message: t("No hay una cuenta vinculada a este usuario", "There is no account linked to this user") };
    }
    if (r.status !== 200) {
      const msg = (r.text() || "").trim();
      return { message: msg || t("No hay una cuenta vinculada a este usuario", "There is no account linked to this user") };
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

// --- Screen App (apiVersion 14) ---

const text = (esText, enText, style) => ({ type: "Text", text: esText, textEn: enText, ...(style ? { style } : {}) });
const button = (esText, enText, onPressed, extra = {}) => ({ type: "ElevatedButton", labelText: esText, labelTextEn: enText, onPressed, ...extra });
const textButton = (esText, enText, onPressed) => ({ type: "TextButton", labelText: esText, labelTextEn: enText, onPressed });
const openUrl = (href, title) => ({ go: { url: { href, title } } });
const isTv = () => kino.device === "tv";
const said = (state) => [state.msg, state.err ? ("❌ " + state.err) : null].filter(Boolean).map((s) => ({ type: "Text", text: s, style: "body" }));

function onlyCurrentOpen(item) {
  if (item.state === "current") return item;
  const { children, ...rest } = item;
  return rest;
}

export async function screen({ state = {} } = {}) {
  const token = getToken(false);

  // 1. Pantalla cuando la cuenta ya está conectada
  if (token) {
    const linked = state.linkedInfo;
    const hasTg = linked && linked.linked;
    const tgUser = linked && linked.telegramUser ? "@" + linked.telegramUser : "";
    const linkCode = linked && linked.linkCode ? linked.linkCode : "";

    return {
      type: "SingleChildScrollView",
      key: "page_connected",
      children: [{
        type: "Column",
        padding: { compact: 16, expanded: 32 },
        gap: 12,
        children: [
          text("JuanSync", "JuanSync", "h1"),
          text("Sincronización en la nube con respaldo y recuperación por Telegram.", "Cloud sync with Telegram backup and account recovery."),
          {
            type: "Card",
            key: "status_card",
            children: [
              text("Estado de tu cuenta", "Account Status", "h2"),
              text("✅ Conectado al servidor de sincronización", "✅ Connected to sync server", "body"),
              hasTg
                ? text("✅ Vinculado a Telegram (" + tgUser + ")", "✅ Linked to Telegram (" + tgUser + ")", "h3")
                : text("⚠️ Tu cuenta no está vinculada a Telegram", "⚠️ Your account is not linked to Telegram", "h3"),
              ...(!hasTg && linkCode ? [
                text("Para no perder tus datos si cambias de dispositivo, abre @JuanSync_bot en Telegram y envía:",
                  "To secure your data if you switch devices, open @JuanSync_bot on Telegram and send:"),
                text("Código: " + linkCode, "Code: " + linkCode, "h2"),
                button("Abrir @JuanSync_bot en Telegram", "Open @JuanSync_bot on Telegram", openUrl("https://t.me/JuanSync_bot", "@JuanSync_bot")),
              ] : []),
              button("Comprobar sincronización", "Check sync status", "screen_check"),
              textButton("Cerrar sesión / Desconectar cuenta", "Log out / Disconnect account", "screen_logout"),
              ...said(state),
            ],
          },
        ],
      }],
    };
  }

  // 2. Pantalla cuando no hay cuenta (Pasos: Registrarse o Recuperar)
  const currentStep = state.activeStep || "register";

  return {
    type: "SingleChildScrollView",
    key: "page_setup",
    children: [{
      type: "Column",
      padding: { compact: 16, expanded: 32 },
      gap: 12,
      children: [
        text("JuanSync", "JuanSync", "h1"),
        text("Sincroniza tu biblioteca, historial y ajustes entre tus dispositivos.", "Sync your library, watch history, and settings across your devices."),
        {
          type: "steps",
          key: "setup_steps",
          items: [
            {
              key: "register",
              title: "Crear cuenta nueva",
              titleEn: "Create new account",
              subtitle: "Un solo toque",
              subtitleEn: "One tap",
              state: currentStep === "register" ? "current" : "pending",
              children: [
                text("Crea tu cuenta de JuanSync con un solo toque sin contraseñas.", "Create your JuanSync account with one tap without passwords."),
                button("Crear mi cuenta", "Create my account", "screen_register"),
                ...(state.registeredCode ? [
                  text("🎉 ¡Cuenta creada con éxito!", "🎉 Account created successfully!", "h2"),
                  text("Tu código de vinculación para Telegram es:", "Your Telegram linking code is:"),
                  text(state.registeredCode, state.registeredCode, "h1"),
                  text("Para no perder tu cuenta, abre @JuanSync_bot en Telegram y envía /vincular " + state.registeredCode,
                    "To secure your account, open @JuanSync_bot on Telegram and send /vincular " + state.registeredCode),
                  button("Abrir @JuanSync_bot en Telegram", "Open @JuanSync_bot on Telegram", openUrl("https://t.me/JuanSync_bot", "@JuanSync_bot")),
                  button("Continuar a mi cuenta", "Continue to my account", "screen_open"),
                ] : []),
                textButton("¿Ya tienes cuenta? Recuperar con Telegram", "Already have an account? Recover with Telegram", "goto_recover"),
                ...said(state),
              ],
            },
            {
              key: "recover",
              title: "Recuperar cuenta existente",
              titleEn: "Recover existing account",
              subtitle: "Con Telegram",
              subtitleEn: "Via Telegram",
              state: currentStep === "recover" ? "current" : "pending",
              children: [
                text("Escribe tu nombre de usuario de Telegram para enviarte un código de acceso:",
                  "Type your Telegram username to receive an access code:"),
                {
                  type: "Form",
                  key: "recover_form",
                  onSubmitted: "screen_request_recover",
                  children: [
                    {
                      type: "TextField",
                      key: "tgUser",
                      labelText: "Usuario de Telegram (sin @)",
                      labelTextEn: "Telegram username (without @)",
                      hintText: "ej: mi_usuario",
                      hintTextEn: "eg: my_username",
                      required: true,
                    },
                    {
                      type: "ElevatedButton",
                      labelText: "1. Pedir código a Telegram",
                      labelTextEn: "1. Request code from Telegram",
                      submit: true,
                    },
                  ],
                },
                ...(state.codeSent ? [
                  text("¡Código enviado a @" + state.recoverUser + "! Ingrésalo para restaurar tu cuenta:",
                    "Code sent to @" + state.recoverUser + "! Enter it to restore your account:", "h3"),
                  {
                    type: "Form",
                    key: "verify_form",
                    onSubmitted: "screen_confirm_recover",
                    children: [
                      {
                        type: "TextField",
                        key: "verifyCode",
                        labelText: "Código de 6 dígitos",
                        labelTextEn: "6-digit code",
                        hintText: "123456",
                        hintTextEn: "123456",
                        maxLength: 6,
                        required: true,
                      },
                      {
                        type: "ElevatedButton",
                        labelText: "2. Restaurar mi cuenta",
                        labelTextEn: "2. Restore my account",
                        submit: true,
                      },
                    ],
                  },
                ] : []),
                textButton("Volver a crear cuenta nueva", "Back to create new account", "goto_register"),
                ...said(state),
              ],
            },
          ].map(onlyCurrentOpen),
        },
      ],
    }],
  };
}

export async function screenEvent({ name, value, arg, state = {} } = {}) {
  // Navegación entre pasos
  if (name === "goto_recover") {
    return { state: { ...state, activeStep: "recover", msg: null, err: null } };
  }
  if (name === "goto_register") {
    return { state: { ...state, activeStep: "register", msg: null, err: null } };
  }

  // Al abrir la pantalla: si hay token, consulta vinculación
  if (name === "open" || name === "screen_open") {
    const token = getToken(false);
    if (token) {
      try {
        const r = await kino.fetch(BASE + "/link-code", {
          method: "GET",
          headers: { "Authorization": "Bearer " + token },
          cookies: false,
          timeoutMs: 10000,
        });
        if (r.status === 200) {
          return { state: { ...state, linkedInfo: r.json() } };
        }
      } catch (_) {}
    }
    return null;
  }

  // Registro desde la App
  if (name === "screen_register") {
    try {
      const r = await kino.fetch(BASE + "/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        cookies: false,
        timeoutMs: 15000,
      });
      if (r.status === 201) {
        const data = r.json() || {};
        return {
          config: { token: data.token },
          state: {
            ...state,
            registeredCode: data.linkCode,
            msg: t("¡Cuenta creada!", "Account created!"),
            err: null,
          },
        };
      }
      return { state: { ...state, err: t("Error al registrarse en el servidor.", "Error registering with server.") } };
    } catch (e) {
      return { state: { ...state, err: t("No se pudo conectar con el servidor.", "Could not reach server.") } };
    }
  }

  // Solicitar código de recuperación desde la App
  if (name === "screen_request_recover") {
    const tgUser = String(value && value.tgUser || arg || "").trim().replace(/^@/, "");
    if (!tgUser) {
      return { state: { ...state, err: t("Ingresa tu usuario de Telegram.", "Enter your Telegram username.") } };
    }
    try {
      const r = await kino.fetch(BASE + "/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: tgUser }),
        cookies: false,
        timeoutMs: 15000,
      });
      if (r.status === 404) {
        return { state: { ...state, err: t("No hay una cuenta vinculada a este usuario", "There is no account linked to this user") } };
      }
      if (r.status !== 200) {
        const bodyText = (r.text() || "").trim();
        return { state: { ...state, err: bodyText || t("No hay una cuenta vinculada a este usuario", "There is no account linked to this user") } };
      }
      return {
        state: {
          ...state,
          codeSent: true,
          recoverUser: tgUser,
          msg: t("¡Código enviado por Telegram a @" + tgUser + "!", "Code sent via Telegram to @" + tgUser + "!"),
          err: null,
        },
      };
    } catch (e) {
      return { state: { ...state, err: t("Error de conexión al solicitar el código.", "Connection error requesting code.") } };
    }
  }

  // Confirmar código de recuperación desde la App
  if (name === "screen_confirm_recover") {
    const tgUser = state.recoverUser;
    const code = String(value && value.verifyCode || arg || "").trim();
    if (!tgUser || !code) {
      return { state: { ...state, err: t("Ingresa el código recibido en Telegram.", "Enter the code received on Telegram.") } };
    }
    try {
      const r = await kino.fetch(BASE + "/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: tgUser, code }),
        cookies: false,
        timeoutMs: 15000,
      });
      if (r.status !== 200) {
        const bodyText = (r.text() || "").trim();
        return { state: { ...state, err: bodyText || t("Código incorrecto o expirado.", "Invalid or expired code.") } };
      }
      const data = r.json() || {};
      if (data.token) {
        return {
          config: { token: data.token },
          state: {
            ...state,
            codeSent: false,
            msg: t("¡Cuenta restaurada con éxito!", "Account restored successfully!"),
            err: null,
          },
        };
      }
      return { state: { ...state, err: t("Respuesta inválida del servidor.", "Invalid response from server.") } };
    } catch (e) {
      return { state: { ...state, err: t("Error de conexión al verificar el código.", "Connection error verifying code.") } };
    }
  }

  // Probar estado
  if (name === "screen_check") {
    const msg = await describe();
    return { state: { ...state, msg, err: null } };
  }

  // Desconectar / Salir
  if (name === "screen_logout") {
    return {
      config: { token: "" },
      state: { msg: t("Sesión cerrada.", "Logged out."), err: null, linkedInfo: null },
    };
  }

  return null;
}
