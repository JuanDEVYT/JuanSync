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
// A stateful, D-pad friendly UI. It uses Kino's declarative widgets so it is
// rendered natively on phones and TVs without embedding a browser.

const text = (esText, enText, style, extra = {}) => ({ type: "Text", text: esText, textEn: enText, ...(style ? { style } : {}), ...extra });
const button = (esText, enText, onPressed, extra = {}) => ({ type: "ElevatedButton", labelText: esText, labelTextEn: enText, onPressed, ...extra });
const textButton = (esText, enText, onPressed, extra = {}) => ({ type: "TextButton", labelText: esText, labelTextEn: enText, onPressed, ...extra });
const openUrl = (href, title) => ({ go: { url: { href, title } } });
const HERO_IMAGE = "https://raw.githubusercontent.com/JuanDEVYT/JuanSync/main/hero.png";

function notice(state) {
  if (!state.msg && !state.err) return null;
  return {
    type: "Card", key: "notice", background: state.err ? "error" : "surfaceVariant", borderRadius: "medium", children: [
      text(state.err || state.msg, state.err || state.msg, "body"),
    ],
  };
}

function accountCard(linkedInfo) {
  const linked = linkedInfo && linkedInfo.linked === true;
  const user = linkedInfo && linkedInfo.telegramUser ? "@" + linkedInfo.telegramUser : "";
  const code = linkedInfo && linkedInfo.linkCode ? linkedInfo.linkCode : "";
  return {
    type: "Card", key: "account", padding: 16, borderRadius: "large", elevation: 2, children: [
      { type: "Row", gap: 12, crossAxisAlignment: "center", children: [
        { type: "CircleAvatar", icon: linked ? "check" : "lock", backgroundColor: linked ? "primary" : "warning" },
        { type: "Column", flex: 1, gap: 4, children: [
          text("Sincronización protegida", "Protected sync", "h3"),
          text("Tu cuenta está lista para sincronizar.", "Your account is ready to sync."),
        ] },
      ] },
      { type: "Divider", margin: { top: 12, bottom: 12 } },
      { type: "ListTile", key: "server-status", leading: { type: "CircleAvatar", icon: "sync", backgroundColor: "primary" }, title: "Servidor JuanSync", titleEn: "JuanSync server", subtitle: "Conectado", subtitleEn: "Connected" },
      linked
        ? { type: "ListTile", key: "telegram-linked", leading: { type: "CircleAvatar", icon: "send", backgroundColor: "primary" }, title: "Telegram vinculado", titleEn: "Telegram linked", subtitle: user || "Listo para recuperar tu cuenta", subtitleEn: user || "Ready to recover your account" }
        : { type: "ListTile", key: "telegram-unlinked", leading: { type: "CircleAvatar", icon: "warning_amber", backgroundColor: "warning" }, title: "Protege tu cuenta con Telegram", titleEn: "Protect your account with Telegram", subtitle: "Vincúlala para recuperarla en otro dispositivo.", subtitleEn: "Link it to recover it on another device." },
      ...(!linked && code ? [
        text("Código de vinculación", "Linking code", "label"),
        text(code, code, "h2", { textAlign: "center" }),
        text("Abre @JuanSync_bot y envía /vincular seguido del código.", "Open @JuanSync_bot and send /vincular followed by the code.", "body"),
        button("Abrir bot de Telegram", "Open Telegram bot", openUrl("https://t.me/JuanSync_bot", "@JuanSync_bot")),
      ] : []),
    ],
  };
}

function connectedBody(state) {
  return {
    type: "SingleChildScrollView", key: "connected-scroll", flex: 1, children: [{
      type: "Column", padding: { compact: 16, expanded: 32 }, gap: 16, maxWidth: 640, alignSelf: "center", children: [
        { type: "heroCard", title: "Todo tu Kino, contigo", titleEn: "Your Kino, with you", image: HERO_IMAGE, text: "Biblioteca, historial y ajustes sincronizados entre tus dispositivos.", textEn: "Library, history and settings synced across your devices.", icon: "sync", buttons: [button("Comprobar conexión", "Check connection", "screen_check")] },
        accountCard(state.linkedInfo),
        ...(notice(state) ? [notice(state)] : []),
        { type: "Card", key: "account-actions", padding: 8, borderRadius: "large", children: [
          text("Administrar cuenta", "Manage account", "h3"),
          { type: "ListTile", key: "refresh-link", leading: { type: "CircleAvatar", icon: "refresh" }, title: "Actualizar estado", titleEn: "Refresh status", subtitle: "Consulta tu vinculación de Telegram.", subtitleEn: "Check your Telegram link.", onTap: "screen_open" },
          { type: "ListTile", key: "logout", leading: { type: "CircleAvatar", icon: "close", backgroundColor: "error" }, title: "Desconectar cuenta", titleEn: "Disconnect account", subtitle: "Elimina el token solo de este dispositivo.", subtitleEn: "Removes the token only from this device.", onTap: "screen_logout" },
        ] },
      ],
    }],
  };
}

function setupBody(state) {
  const tab = state.activeStep || "register";
  const registered = !!state.registeredCode;
  const recovery = tab === "recover";
  const content = recovery ? [
    text("Recupera tu cuenta", "Recover your account", "h2"),
    text("Te enviaremos un código mediante el bot de Telegram vinculado.", "We will send a code through your linked Telegram bot."),
    { type: "Form", key: "recover-form", onSubmitted: "screen_request_recover", children: [
      { type: "TextField", key: "tgUser", labelText: "Usuario de Telegram", labelTextEn: "Telegram username", hintText: "mi_usuario, sin @", hintTextEn: "my_username, without @", required: true },
      { type: "ElevatedButton", labelText: "Enviar código", labelTextEn: "Send code", submit: true },
    ] },
    ...(state.codeSent ? [
      { type: "Card", key: "verify-card", padding: 16, borderRadius: "medium", children: [
        text("Código enviado a @" + state.recoverUser, "Code sent to @" + state.recoverUser, "h3"),
        { type: "Form", key: "verify-form", onSubmitted: "screen_confirm_recover", children: [
          { type: "TextField", key: "verifyCode", labelText: "Código de 6 dígitos", labelTextEn: "6-digit code", hintText: "123456", maxLength: 6, required: true },
          { type: "ElevatedButton", labelText: "Restaurar mi cuenta", labelTextEn: "Restore my account", submit: true },
        ] },
      ] },
    ] : []),
    textButton("Crear una cuenta nueva", "Create a new account", "goto_register"),
  ] : [
    text("Crea tu espacio sincronizado", "Create your synced space", "h2"),
    text("Sin contraseñas. Tu cuenta se crea con un toque y después puedes asegurarla con Telegram.", "No passwords. Create your account in one tap, then secure it with Telegram."),
    button("Crear mi cuenta", "Create my account", "screen_register", { minHeight: 48 }),
    ...(registered ? [
      { type: "Card", key: "created", padding: 16, background: "surfaceVariant", borderRadius: "medium", children: [
        text("Cuenta creada", "Account created", "h3"),
        text("Tu código de vinculación", "Your linking code", "label"),
        text(state.registeredCode, state.registeredCode, "h1", { textAlign: "center" }),
        text("Guárdalo enviándolo a @JuanSync_bot con /vincular.", "Keep it safe by sending it to @JuanSync_bot with /vincular."),
        button("Abrir bot de Telegram", "Open Telegram bot", openUrl("https://t.me/JuanSync_bot", "@JuanSync_bot")),
        { type: "Button", variant: "secondary", labelText: "Continuar", labelTextEn: "Continue", onPressed: "screen_open" },
      ] },
    ] : []),
    textButton("Ya tengo cuenta: recuperarla", "I already have an account: recover it", "goto_recover"),
  ];
  return {
    type: "SingleChildScrollView", key: "setup-scroll", flex: 1, children: [{
      type: "Column", padding: { compact: 16, expanded: 32 }, gap: 16, maxWidth: 640, alignSelf: "center", children: [
        { type: "heroCard", title: "JuanSync", image: HERO_IMAGE, text: "Tu Kino permanece contigo, en cada pantalla.", textEn: "Your Kino stays with you, on every screen.", icon: "sync" },
        { type: "steps", key: "setup-progress", items: [
          { key: "create", title: "Crear", titleEn: "Create", subtitle: "Un toque", subtitleEn: "One tap", state: recovery || registered ? "done" : "current" },
          { key: "protect", title: "Proteger", titleEn: "Protect", subtitle: "Telegram", state: recovery || registered ? "current" : "pending" },
          { key: "sync", title: "Sincronizar", titleEn: "Sync", subtitle: "En todos tus dispositivos", subtitleEn: "On every device", state: "pending" },
        ] },
        { type: "Card", key: recovery ? "recover-card" : "register-card", padding: 16, borderRadius: "large", elevation: 2, children: content },
        ...(notice(state) ? [notice(state)] : []),
      ],
    }],
  };
}

export async function screen({ state = {} } = {}) {
  const connected = !!getToken(false);
  // Kino provides the screen title and close controls; do not duplicate its AppBar.
  return connected ? connectedBody(state) : setupBody(state);
}

export async function screenEvent({ name, value, values, arg, state = {} } = {}) {
  const form = values || value || {};
  if (name === "goto_recover") return { state: { ...state, activeStep: "recover", msg: null, err: null } };
  if (name === "goto_register") return { state: { ...state, activeStep: "register", msg: null, err: null } };
  if (name === "screen_reset") return { state: { activeStep: "register", msg: null, err: null } };

  if (name === "open" || name === "screen_open") {
    const token = getToken(false);
    if (!token) return { state: { ...state, activeStep: "register" } };
    try {
      const r = await kino.fetch(BASE + "/link-code", { method: "GET", headers: { Authorization: "Bearer " + token }, cookies: false, timeoutMs: 10000 });
      if (r.status === 200) return { state: { ...state, linkedInfo: r.json(), msg: null, err: null } };
      return { state: { ...state, err: t("No se pudo actualizar el estado de la cuenta.", "Could not refresh account status.") } };
    } catch (_) { return { state: { ...state, err: t("No se pudo conectar con el servidor.", "Could not reach the server.") } }; }
  }

  if (name === "screen_register") {
    try {
      const r = await kino.fetch(BASE + "/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}), cookies: false, timeoutMs: 15000 });
      const data = r.status === 201 ? r.json() || {} : null;
      if (!data || !data.token) return { state: { ...state, err: t("No se pudo crear la cuenta. Inténtalo de nuevo.", "Could not create the account. Try again.") } };
      return { config: { token: data.token }, state: { ...state, registeredCode: data.linkCode || "", msg: t("Cuenta creada. Protégela vinculando Telegram.", "Account created. Protect it by linking Telegram."), err: null } };
    } catch (_) { return { state: { ...state, err: t("No se pudo conectar con el servidor.", "Could not reach the server.") } }; }
  }

  if (name === "screen_request_recover") {
    const tgUser = String(form.tgUser || arg || "").trim().replace(/^@/, "");
    if (!tgUser) return { state: { ...state, activeStep: "recover", err: t("Escribe tu usuario de Telegram.", "Enter your Telegram username.") } };
    try {
      const r = await kino.fetch(BASE + "/recover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account: tgUser }), cookies: false, timeoutMs: 15000 });
      if (r.status !== 200) return { state: { ...state, activeStep: "recover", err: t("No hay una cuenta vinculada a ese usuario.", "There is no account linked to that user.") } };
      return { state: { ...state, activeStep: "recover", codeSent: true, recoverUser: tgUser, msg: t("Código enviado por Telegram.", "Code sent through Telegram."), err: null } };
    } catch (_) { return { state: { ...state, activeStep: "recover", err: t("No se pudo solicitar el código.", "Could not request the code.") } }; }
  }

  if (name === "screen_confirm_recover") {
    const tgUser = state.recoverUser;
    const code = String(form.verifyCode || arg || "").trim();
    if (!tgUser || !code) return { state: { ...state, err: t("Introduce el código que recibiste.", "Enter the code you received.") } };
    try {
      const r = await kino.fetch(BASE + "/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account: tgUser, code }), cookies: false, timeoutMs: 15000 });
      const data = r.status === 200 ? r.json() || {} : null;
      if (!data || !data.token) return { state: { ...state, err: t("Código incorrecto o expirado.", "Invalid or expired code.") } };
      return { config: { token: data.token }, state: { ...state, codeSent: false, msg: t("Cuenta restaurada correctamente.", "Account restored successfully."), err: null } };
    } catch (_) { return { state: { ...state, err: t("No se pudo verificar el código.", "Could not verify the code.") } }; }
  }

  if (name === "screen_check") {
    const status = await syncStatus();
    return { state: { ...state, msg: status.message, err: null } };
  }
  if (name === "screen_logout") return { config: { token: "" }, state: { activeStep: "register", msg: t("Cuenta desconectada de este dispositivo.", "Account disconnected from this device."), err: null, linkedInfo: null } };
  return null;
}
